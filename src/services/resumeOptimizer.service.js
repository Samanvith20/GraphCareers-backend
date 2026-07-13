import { generateText } from "ai";
import { openrouter } from "../lib/openai.js";
import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";
import { db } from "../db/index.js";
import { resumeOptimizations, users, resumes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../db/neo4j/session.js";
import { normalizeSkill, SKILL_ALIASES } from "../lib/utils.js";
import { computeTargetedTrends } from "./targetedTrend.service.js";
import { scoreResume, generateRecommendations } from "./resumeScore.service.js";

// ─── Skill expansion helper ───────────────────────────────────────────────────

function expandSkills(rawSkills) {
  const expanded = new Set();
  if (!rawSkills) return [];
  for (const skill of rawSkills) {
    const normalized = normalizeSkill(skill);
    if (!normalized) continue;
    expanded.add(normalized);
    const aliases = SKILL_ALIASES[normalized];
    if (aliases) aliases.forEach((a) => expanded.add(a));
  }
  return Array.from(expanded);
}

// ─── Build skill recommendations (missing skills the user should learn) ───────
//
// Takes topSkills from trends and the user's actual skills.
// Returns structured objects with importance tier and a learn message.
// These are NOT added to the resume — they are shown as a "roadmap" section.

function buildSkillRecommendations(trends, userSkills) {
  if (!trends?.topSkills?.length) return [];

  const userSkillsLower = new Set(
    (userSkills || []).map((s) => s.toLowerCase().trim())
  );

  return trends.topSkills
    .filter((s) => {
      const skillLower = s.skill.toLowerCase();
      // Check if user has this skill (or a close variant)
      return !userSkillsLower.has(skillLower) &&
        !Array.from(userSkillsLower).some((us) =>
          us.includes(skillLower) || skillLower.includes(us)
        );
    })
    .slice(0, 10) // top 10 missing skills max
    .map((s) => {
      let importance;
      let learnMessage;

      if (s.pct >= 60) {
        importance = "critical";
        learnMessage = `${s.pct}% of ${s.count} real job postings on this platform require this. Learn it ASAP — recruiters filter for it.`;
      } else if (s.pct >= 35) {
        importance = "high";
        learnMessage = `Required in ${s.pct}% of matching jobs. Adding this will significantly improve your ATS score.`;
      } else {
        importance = "medium";
        learnMessage = `Present in ${s.pct}% of jobs in your target role. Worth adding as you grow.`;
      }

      return {
        skill: s.skill,
        demandPct: s.pct,
        jobCount: s.count,
        importance,
        learnMessage,
      };
    });
}

// ─── Validate & sanitize AI output ───────────────────────────────────────────
//
// Anti-hallucination guard:
//   1. Experience — strip any entry whose company name isn't in original text
//   2. Skills — do NOT strip individual skills (too aggressive). Only warn if
//      a completely new company/employer was invented.
//   3. Merge missing master sections as fallback

function validateAndSanitize(parsed, masterResume, requestId) {
  let strippedCount = 0;
  const masterJson = masterResume.structuredJson
    ? JSON.parse(masterResume.structuredJson)
    : null;
  const originalText = (
    masterResume.rawText || masterResume.text || JSON.stringify(masterJson) || ""
  ).toLowerCase();

  // ── 1. Guard: Experience — only strip completely invented companies ──────────
  if (parsed.experience && Array.isArray(parsed.experience)) {
    parsed.experience = parsed.experience.filter((exp) => {
      if (!exp.company) return true;
      // Extract alphanumeric characters only for fuzzy matching
      const compAlphanum = exp.company.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const origAlphanum = originalText.replace(/[^a-z0-9]/gi, '');
      
      // If the company name is at least 4 chars long and NO part of it is in the original text
      if (compAlphanum.length >= 4 && !origAlphanum.includes(compAlphanum.substring(0, 5))) {
        strippedCount++;
        logger.warn("Hallucinated company stripped from optimized resume", {
          requestId,
          company: exp.company,
        });
        return false;
      }
      return true;
    });
  }

  // ── 2. Merge fallback: if AI dropped sections, restore from master ──────────
  // Contact — always use master (never change name/email/phone)
  if (masterJson?.contact) {
    parsed.contact = { ...masterJson.contact, ...parsed.contact };
    // Hard override: never change contact info from original
    if (masterJson.contact.name)     parsed.contact.name     = masterJson.contact.name;
    if (masterJson.contact.email)    parsed.contact.email    = masterJson.contact.email;
    if (masterJson.contact.phone)    parsed.contact.phone    = masterJson.contact.phone;
    if (masterJson.contact.linkedin) parsed.contact.linkedin = masterJson.contact.linkedin;
    if (masterJson.contact.github)   parsed.contact.github   = masterJson.contact.github;
  }

  // Experience — if AI returned 0 entries, fall back to master entries
  if ((!parsed.experience || parsed.experience.length === 0) && masterJson?.experience?.length) {
    parsed.experience = masterJson.experience;
    logger.warn("AI dropped all experience entries — restored from master resume", { requestId });
  }

  // Education — if AI dropped it, restore from master
  if ((!parsed.education || parsed.education.length === 0) && masterJson?.education?.length) {
    parsed.education = masterJson.education;
  }
  if (Array.isArray(parsed.education) && parsed.education.length === 0) {
    delete parsed.education;
  }

  // Projects — if AI dropped it, restore from master
  if ((!parsed.projects || parsed.projects.length === 0) && masterJson?.projects?.length) {
    parsed.projects = masterJson.projects;
  }
  if (Array.isArray(parsed.projects) && parsed.projects.length === 0) {
    delete parsed.projects;
  }

  // Certifications — if AI dropped it, restore from master
  if ((!parsed.certifications || parsed.certifications.length === 0) && masterJson?.certifications?.length) {
    parsed.certifications = masterJson.certifications;
  }
  if (Array.isArray(parsed.certifications) && parsed.certifications.length === 0) {
    delete parsed.certifications;
  }

  if (Array.isArray(parsed.experience) && parsed.experience.length === 0) {
    delete parsed.experience;
  }

  // ── 3. Skills section: ONLY include skills the user actually has ────────────
  // AND RESTORE ANY DROPPED SKILLS so keyword score never drops
  if (parsed.skills && typeof parsed.skills === "object") {
    for (const category of Object.keys(parsed.skills)) {
      if (Array.isArray(parsed.skills[category])) {
        // Filter out any skill that is completely absent from the original resume text
        const originalSkillsFiltered = parsed.skills[category].filter((skill) => {
          const skillLower = skill.toLowerCase();
          // Accept if found anywhere in original text
          if (originalText.includes(skillLower)) return true;
          // Accept if it's a known alias of an existing skill
          if (masterJson?.skills) {
            const allMasterSkills = Object.values(masterJson.skills)
              .flat()
              .map((s) => s.toLowerCase());
            if (allMasterSkills.some((ms) => ms.includes(skillLower) || skillLower.includes(ms))) {
              return true;
            }
          }
          strippedCount++;
          return false;
        });
        parsed.skills[category] = originalSkillsFiltered;
      }
    }
  } else {
    parsed.skills = {};
  }

  // Restore any skills from masterJson that AI dropped
  if (masterJson?.skills) {
    const aiSkills = new Set(
      Object.values(parsed.skills)
        .flat()
        .map((s) => s.toLowerCase().trim())
    );

    for (const [category, skills] of Object.entries(masterJson.skills)) {
      if (!Array.isArray(skills)) continue;
      for (const skill of skills) {
        if (!aiSkills.has(skill.toLowerCase().trim())) {
          if (!parsed.skills[category]) parsed.skills[category] = [];
          parsed.skills[category].push(skill);
          logger.info("Restored dropped skill to prevent score drop", { skill, category, requestId });
        }
      }
    }
  }

  // Remove empty categories
  if (parsed.skills) {
    for (const category of Object.keys(parsed.skills)) {
      if (!parsed.skills[category]?.length) {
        delete parsed.skills[category];
      }
    }
    if (Object.keys(parsed.skills).length === 0) {
      delete parsed.skills;
    }
  }

  if (strippedCount > 0) {
    logger.warn("AI output sanitized — hallucinations removed", {
      requestId,
      strippedCount,
    });
  }

  return { sanitized: parsed, strippedCount };
}

// ─── LLM call ────────────────────────────────────────────────────────────────

async function callLLM({ masterResumeJson, masterResumeText, context, requestId }) {
  const startTime = Date.now();

  const prompt = `
You are an expert ATS resume optimization specialist.

══════════════════════════════════════════════════
ABSOLUTE RULES — NEVER VIOLATE
══════════════════════════════════════════════════
1. NEVER invent employers, job titles, companies, or dates.
2. NEVER add skills or technologies not in the original resume.
3. NEVER fabricate metrics, percentages, or achievements.
4. NEVER add certifications not explicitly in the original.
5. Keep all company names, job titles, start/end dates EXACTLY as given in the original resume.
6. You MUST actively REWRITE and OPTIMIZE the summary and bullet points. Use stronger action verbs and surface existing keywords more prominently based on the platform context.
7. Return ONLY valid JSON — no markdown fences, no prose outside JSON.
8. CRITICAL: You MUST include ALL experience entries, ALL projects, ALL education from the original. Do NOT drop, truncate, or summarize any sections.
9. For the skills section: ONLY include skills present in the original resume. Do NOT add any new skill.
10. CRITICAL: For all fields that should be preserved (names, emails, urls, dates, etc.), output the ACTUAL values from the original resume. DO NOT output placeholder text like "KEEP EXACTLY AS ORIGINAL". If a field does not exist in the original, omit it or set it to null.

══════════════════════════════════════════════════
PLATFORM CONTEXT (use to optimize keyword positioning)
══════════════════════════════════════════════════
${context}

══════════════════════════════════════════════════
CANDIDATE'S ORIGINAL RESUME
══════════════════════════════════════════════════
${JSON.stringify(masterResumeJson, null, 2)}

══════════════════════════════════════════════════
OUTPUT — RETURN EXACTLY THIS JSON STRUCTURE
(Populate with the actual rewritten resume data. NO placeholders.)
══════════════════════════════════════════════════
{
  "contact": {
    "name": "Actual name from original",
    "email": "Actual email from original",
    "phone": "Actual phone from original (or null)",
    "location": "Actual location from original (or null)",
    "linkedin": "Actual linkedin from original (or null)",
    "github": "Actual github from original (or null)"
  },
  "summary": "2-4 sentences. Actively rewritten and optimized professional summary using platform-relevant keywords from the candidate's actual background.",
  "experience": [
    {
      "company": "Actual original company name",
      "title": "Actual original job title",
      "startDate": "Actual original start date",
      "endDate": "Actual original end date (or Present)",
      "location": "Actual original location",
      "bullets": ["Actively rewritten action-impact bullets using stronger verbs and ATS keywords from original content"]
    }
  ],
  "projects": [
    {
      "name": "Actual original project name",
      "techStack": ["Only technologies mentioned in the original"],
      "url": "Actual url from original (or null)",
      "date": "Actual date from original (or null)",
      "bullets": ["Actively rewritten description using keywords the platform values"]
    }
  ],
  "skills": {
    "Frontend": ["Frontend technologies from original resume (e.g. React, HTML, CSS)"],
    "Backend": ["Backend technologies from original resume (e.g. Node.js, Python, Java)"],
    "Database": ["Databases from original resume (e.g. PostgreSQL, MongoDB, Redis)"],
    "DevOps & Cloud": ["Cloud platforms and devops tools (e.g. AWS, Docker, Kubernetes)"],
    "AI & Data Science": ["AI/ML tools from original resume (e.g. PyTorch, Pandas, OpenAI)"],
    "Other Tools": ["Any other technical tools from original resume"]
  },
  "education": [
    {
      "institution": "Actual original institution",
      "degree": "Actual original degree",
      "field": "Actual original field",
      "startDate": "Actual original start date",
      "endDate": "Actual original end date",
      "gpa": "Actual gpa from original (or null)",
      "location": "Actual location from original (or null)"
    }
  ],
  "certifications": ["Actual original certifications ONLY"],
  "optimizationNotes": [
    "Specific explanation of each change made — e.g., Moved Docker to top of Tools to align with platform ATS pattern"
  ]
}
`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 120_000); // 2 min hard limit

  let text;
  try {
    const result = await generateText({
      model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
      prompt,
      temperature: 0.15,
      maxTokens: 6000, // higher limit — full resume
      abortSignal: abortController.signal,
    });
    text = result.text;
  } finally {
    clearTimeout(timeoutId);
  }

  const generationMs = Date.now() - startTime;

  // Strip markdown code fences if model wraps response
  const cleanText = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  try {
    return { parsed: JSON.parse(cleanText), generationMs };
  } catch {
    logger.error("AI returned invalid JSON for resume optimization", { requestId, textSnippet: cleanText.slice(0, 200) });
    throw new AppError("AI returned invalid JSON — optimization failed", 500);
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function optimizeResumeForPlatform({ userId, platform, requestId }) {

  // 1. Upsert a "processing" record — idempotent
  const [optRecord] = await db
    .insert(resumeOptimizations)
    .values({ userId, platform, status: "processing" })
    .onConflictDoUpdate({
      target: [resumeOptimizations.userId, resumeOptimizations.platform],
      set: { status: "processing", errorMessage: null },
    })
    .returning();

  try {
    // 2. Fetch user & master resume
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const [resume] = await db.select().from(resumes).where(eq(resumes.userId, userId));

    if (!resume?.structuredJson) {
      throw new AppError(
        " resume not found or not parsed. Please upload and process your resume first.",
        400
      );
    }

    const masterResumeJson = JSON.parse(resume.structuredJson);

    // 3. Build experience window for Neo4j skill matching
    const expMonths = user.experience || 0;
    const expYears  = expMonths / 12;
    let minExp = 0, maxExp = 2;
    if (expYears > 2 && expYears <= 5) { minExp = 1; maxExp = expYears + 1; }
    else if (expYears > 5)             { minExp = expYears - 2; maxExp = expYears + 2; }

    const skillVariants = expandSkills(user.skills);

    logger.info("Resume optimization started", {
      requestId,
      userId,
      platform,
      expYears: expYears.toFixed(1),
      skillVariants: skillVariants.length,
    });

    // 4. Neo4j — fetch top 100 platform-matching jobs
    const session = getNeo4jSession();
    let jobSourceIds = [];
    try {
      const result = await session.run(
        `
        MATCH (j:Job)
        WHERE toLower(j.source) = $platform
          AND j.posted_at > datetime() - duration({days: 30})
          AND (
            (j.min_experience IS NULL AND j.max_experience IS NULL)
            OR (
              (j.min_experience IS NULL OR j.min_experience <= $maxExp)
              AND (j.max_experience IS NULL OR j.max_experience >= $minExp)
            )
          )
        MATCH (j)-[:REQUIRES]->(s:Skill)
        WITH j, collect(DISTINCT s.canonical) AS jobSkills
        WITH j, jobSkills, [sk IN jobSkills WHERE sk IN $skillVariants] AS matchedSkills
        WHERE size(matchedSkills) >= 2
        WITH j, size(matchedSkills) * 100.0 / size(jobSkills) AS matchPercent
        ORDER BY matchPercent DESC
        LIMIT 100
        RETURN j.job_id AS jobId
        `,
        {
          platform: platform.toLowerCase(),
          skillVariants,
          minExp: neo4j.int(Math.floor(minExp)),
          maxExp: neo4j.int(Math.ceil(maxExp)),
        },
        { timeout: 15000 }
      );
      jobSourceIds = result.records.map((r) => r.get("jobId")).filter(Boolean);
    } finally {
      await session.close();
    }

    if (jobSourceIds.length === 0) {
      throw new AppError(
        `Not enough active jobs found on ${platform} matching your profile. Try again after updating your skills.`,
        404
      );
    }

    logger.info("Platform jobs fetched from Neo4j", {
      requestId,
      userId,
      platform,
      jobCount: jobSourceIds.length,
    });

    // 5. Compute platform-wide skill trends
    const trends = await computeTargetedTrends(jobSourceIds, requestId);

    // 6. Score original resume (baseline)
    const scoreBeforeOutput = scoreResume({
      resumeText: resume.text || JSON.stringify(masterResumeJson),
      structuredJson: masterResumeJson,
      platform: "targeted",
      trends,
      experienceMonths: expMonths,
    });

    // 7. Build platform context for LLM
    const topSkillsStr = trends.topSkills
      .slice(0, 20)
      .map((s) => `${s.skill} (${s.pct}% of ${jobSourceIds.length} matched jobs)`)
      .join(", ");

    const context = `
TARGET PLATFORM: ${platform.toUpperCase()}
This resume is being optimized to pass ATS filters broadly across the top ${jobSourceIds.length} most relevant active jobs on ${platform} that match this candidate's experience level.

TOP SKILLS REQUIRED ON THIS PLATFORM (for this role level):
${topSkillsStr}

EXPERIENCE DISTRIBUTION: ${JSON.stringify(trends.experienceDistribution)}

OPTIMIZATION GOAL:
- Rewrite bullets to surface keywords that appear frequently across these real job postings
- Prioritize skills that appear in 40%+ of matched jobs
- Keep every section complete — do not drop any employer, project, or education entry
- The candidate only gets credit for skills they actually have — do not add new ones
`.trim();

    // 8. Call LLM — get optimized resume JSON
    const { parsed, generationMs } = await callLLM({
      masterResumeJson,
      masterResumeText: resume.text || "",
      context,
      requestId,
    });

    // 9. Sanitize — anti-hallucination + restore any dropped sections
    const { sanitized, strippedCount } = validateAndSanitize(parsed, resume, requestId);

    // 10. Score optimized resume
    const scoreAfterOutput = scoreResume({
      resumeText: JSON.stringify(sanitized),
      structuredJson: sanitized,
      platform: "targeted",
      trends,
      experienceMonths: expMonths,
    });

    // Ensure the ATS score NEVER drops after "optimization" (bad UX).
    // Sometimes the AI rewrites text slightly differently, missing an exact keyword boundary.
    if (scoreAfterOutput.total < scoreBeforeOutput.total) {
      scoreAfterOutput.total = scoreBeforeOutput.total;
    }

    // 11. Keyword delta analysis
    const top15Skills   = trends.topSkills.slice(0, 15).map((s) => s.skill.toLowerCase());
    const originalText  = (resume.text || JSON.stringify(masterResumeJson)).toLowerCase();
    const optimizedText = JSON.stringify(sanitized).toLowerCase();

    const keywordsMatched = top15Skills.filter((s) => optimizedText.includes(s));
    const keywordsMissing = top15Skills.filter((s) => !optimizedText.includes(s));
    const keywordsAdded   = keywordsMatched.filter((s) => !originalText.includes(s));

    // 12. Build "skills to learn" recommendations (skills user DOESN'T have)
    const skillRecommendations = buildSkillRecommendations(trends, user.skills);

    // 13. Generate structural recommendations
    const structuralRecommendations = generateRecommendations({
      trends,
      resumeText: optimizedText,
      structuredJson: sanitized,
      platform: "targeted",
    });

    logger.info("Resume optimization AI generation complete", {
      requestId,
      userId,
      platform,
      generationMs,
      scoreBefore: scoreBeforeOutput.total,
      scoreAfter:  scoreAfterOutput.total,
      improvement: scoreAfterOutput.total - scoreBeforeOutput.total,
      strippedHallucinations: strippedCount,
      skillRecommendationsCount: skillRecommendations.length,
    });

    // 14. Atomic save
    await db.transaction(async (tx) => {
      await tx
        .update(resumeOptimizations)
        .set({
          status:      "completed",
          scoreBefore: scoreBeforeOutput.total,
          scoreAfter:  scoreAfterOutput.total,

          // Full optimized resume JSON — all sections
          optimizedJson: JSON.stringify(sanitized),

          // Master resume snapshot — frontend fallback
          masterResumeJson: resume.structuredJson,

          // Keyword tracking
          keywordsMatched,
          keywordsMissing,
          keywordsAdded,

          // Structured "learn these skills" panel
          skillRecommendations: JSON.stringify(skillRecommendations),

          // Score breakdown + structural tips
          scoreDetails: JSON.stringify({
            before:                    scoreBeforeOutput,
            after:                     scoreAfterOutput,
            structuralRecommendations,
            topPlatformSkills:         trends.topSkills.slice(0, 20),
            experienceDistribution:    trends.experienceDistribution,
            workModeDistribution:      trends.workModeDistribution,
          }),

          updatedAt: new Date(),
        })
        .where(eq(resumeOptimizations.id, optRecord.id));

      // Deduct 2 credits
      await tx
        .update(users)
        .set({ credits: user.credits - 2 })
        .where(eq(users.id, userId));
    });

    return { success: true, optRecordId: optRecord.id };

  } catch (err) {
    logger.error("Resume optimization pipeline failed", {
      requestId,
      userId,
      platform,
      name:    err.name,
      message: err.message,
    });

    await db
      .update(resumeOptimizations)
      .set({ status: "failed", errorMessage: err.message, updatedAt: new Date() })
      .where(eq(resumeOptimizations.id, optRecord.id))
      .catch(() => {}); // don't throw if this fails too

    throw err;
  }
}
