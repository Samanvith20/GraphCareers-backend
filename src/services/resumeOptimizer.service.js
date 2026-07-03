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
    // Hard override: never change name or email from original
    if (masterJson.contact.name)  parsed.contact.name  = masterJson.contact.name;
    if (masterJson.contact.email) parsed.contact.email = masterJson.contact.email;
    if (masterJson.contact.phone) parsed.contact.phone = masterJson.contact.phone;
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

  // Projects — if AI dropped it, restore from master
  if ((!parsed.projects || parsed.projects.length === 0) && masterJson?.projects?.length) {
    parsed.projects = masterJson.projects;
  }

  // Certifications — if AI dropped it, restore from master
  if ((!parsed.certifications || parsed.certifications.length === 0) && masterJson?.certifications?.length) {
    parsed.certifications = masterJson.certifications;
  }

  // ── 3. Skills section: ONLY include skills the user actually has ────────────
  // Do NOT add skills that aren't in the original. Clean up empty categories.
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
    // Remove empty categories
    for (const category of Object.keys(parsed.skills)) {
      if (!parsed.skills[category]?.length) {
        delete parsed.skills[category];
      }
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
5. Keep all company names, job titles, start/end dates EXACTLY as given.
6. You MAY: improve bullet phrasing, strengthen summary tone, surface existing keywords more prominently, reorder skill categories.
7. Return ONLY valid JSON — no markdown fences, no prose outside JSON.
8. CRITICAL: You MUST include ALL experience entries, ALL projects, ALL education from the original. Do NOT drop, truncate, or summarize any sections.
9. For the skills section: ONLY include skills present in the original resume. Do NOT add any new skill.

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
(preserve all original data, only enhance phrasing)
══════════════════════════════════════════════════
{
  "contact": {
    "name": "KEEP EXACTLY AS ORIGINAL",
    "email": "KEEP EXACTLY AS ORIGINAL",
    "phone": "KEEP EXACTLY AS ORIGINAL",
    "location": "KEEP EXACTLY AS ORIGINAL",
    "linkedin": "KEEP EXACTLY AS ORIGINAL",
    "github": "KEEP EXACTLY AS ORIGINAL"
  },
  "summary": "2-4 sentences. Optimized professional summary using platform-relevant keywords from the candidate's actual background.",
  "experience": [
    {
      "company": "EXACT ORIGINAL COMPANY NAME",
      "title": "EXACT ORIGINAL JOB TITLE",
      "startDate": "EXACT ORIGINAL DATE",
      "endDate": "EXACT ORIGINAL DATE (or Present)",
      "location": "EXACT ORIGINAL LOCATION",
      "bullets": ["Rewritten action-impact bullets using stronger verbs and ATS keywords from original content"]
    }
  ],
  "projects": [
    {
      "name": "EXACT ORIGINAL PROJECT NAME",
      "techStack": ["Only technologies mentioned in the original"],
      "url": "KEEP EXACTLY AS ORIGINAL",
      "date": "KEEP AS ORIGINAL",
      "bullets": ["Enhanced description using keywords the platform values"]
    }
  ],
  "skills": {
    "Languages": ["Only languages from original resume"],
    "Frameworks": ["Only frameworks from original resume"],
    "Databases": ["Only databases from original resume"],
    "Tools & DevOps": ["Only tools from original resume"],
    "Other": ["Any other technical skills from original resume"]
  },
  "education": [
    {
      "institution": "EXACT ORIGINAL INSTITUTION",
      "degree": "EXACT ORIGINAL DEGREE",
      "field": "EXACT ORIGINAL FIELD",
      "startDate": "EXACT ORIGINAL",
      "endDate": "EXACT ORIGINAL",
      "gpa": "KEEP AS ORIGINAL",
      "location": "KEEP AS ORIGINAL"
    }
  ],
  "certifications": ["EXACT ORIGINAL CERTIFICATIONS ONLY"],
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
        "Master resume not found or not parsed. Please upload and process your resume first.",
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
