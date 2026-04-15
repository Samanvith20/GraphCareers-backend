// routes/resume.analyze.js
// POST /api/resume/analyze/:jobSourceId  — free
// POST /api/resume/optimize/:jobSourceId — 1 credit, returns full resume JSON

import { Router } from "express";
import { db } from "../db/index.js";
import { resumes, jobs, jobMatches, resumeOptimizations, aiUsageLogs, users } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";
import { authMiddleware } from "../middleware/auth.js";
import { generateText } from "ai";
import { openrouter } from "../lib/openai.js";

const router = Router();

// ── TOP-LEVEL CONSTANTS (must be here, not in the middle of the file) ─────────
const OPENROUTER_URL = process.env.OPENAI_BASE_URL
const MODEL          = process.env.OPENROUTER_MODEL || "gpt-4.1-mini";

// ─────────────────────────────────────────────────────────────────────────────
// ATS SCORER
// ─────────────────────────────────────────────────────────────────────────────

export function computeATSScore(resumeText, matchedSkills, missingSkills) {
  const totalSkills  = matchedSkills.length + missingSkills.length;
  const keywordRatio = totalSkills > 0 ? matchedSkills.length / totalSkills : 0;
  const keywordPts   = Math.round(keywordRatio * 40);

  const hasSummary = /summary|objective|profile|about me/i.test(resumeText) ? 15 : 0;

  const actionVerbs = [
    "built","developed","designed","led","managed","reduced","increased",
    "implemented","created","architected","optimized","delivered","launched",
    "improved","automated","migrated","scaled","integrated","streamlined","owned",
  ];
  const bulletLines = resumeText.split("\n").filter((l) =>
    l.trim().startsWith("•") || l.trim().startsWith("-") || /^\*/.test(l.trim())
  );
  const verbBullets = bulletLines.filter((l) => actionVerbs.some((v) => l.toLowerCase().includes(v)));
  const verbPts     = Math.round((bulletLines.length > 0 ? verbBullets.length / bulletLines.length : 0) * 15);

  const quantPattern = /\d+%|\d+x|\$\d+|\d+ (users|customers|teams|engineers|ms|seconds|hours|days|months)/i;
  const quantBullets = bulletLines.filter((l) => quantPattern.test(l));
  const quantPts     = Math.round(Math.min(bulletLines.length > 0 ? quantBullets.length / bulletLines.length : 0, 1) * 15);

  const wordCount = resumeText.split(/\s+/).filter(Boolean).length;
  const wordPts   = wordCount >= 300 && wordCount <= 900 ? 10 : wordCount >= 200 ? 5 : 0;

  const hasEmail   = /@[a-z0-9.-]+\.[a-z]{2,}/i.test(resumeText);
  const hasPhone   = /(\+91|0)?[\s-]?[6-9]\d{9}|\(\d{3}\)\s?\d{3}-\d{4}/.test(resumeText);
  const contactPts = hasEmail && hasPhone ? 5 : hasEmail ? 3 : 0;

  return {
    score: Math.min(keywordPts + hasSummary + verbPts + quantPts + wordPts + contactPts, 100),
    breakdown: {
      keywords:    { points: keywordPts,  max: 40, label: `${matchedSkills.length}/${totalSkills} keywords matched` },
      summary:     { points: hasSummary,  max: 15, label: hasSummary ? "Summary section found" : "No summary section" },
      actionVerbs: { points: verbPts,     max: 15, label: `${verbBullets.length}/${bulletLines.length} bullets use action verbs` },
      quantified:  { points: quantPts,    max: 15, label: `${quantBullets.length} bullets have metrics/numbers` },
      length:      { points: wordPts,     max: 10, label: `${wordCount} words (ideal: 300–900)` },
      contact:     { points: contactPts,  max: 5,  label: hasEmail && hasPhone ? "Email + phone found" : "Missing contact info" },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RESUME SEGMENTER
// ─────────────────────────────────────────────────────────────────────────────

function segmentResume(text) {
  const sectionPatterns = [
    ["summary",        /^(summary|objective|professional\s+summary|profile|about\s+me)/im],
    ["experience",     /^(experience|work\s+experience|employment|work\s+history)/im],
    ["education",      /^(education|academic|qualifications)/im],
    ["skills",         /^(skills|technical\s+skills|core\s+competencies|expertise)/im],
    ["projects",       /^(projects|personal\s+projects|key\s+projects)/im],
    ["certifications", /^(certifications|certificates|licenses)/im],
  ];

  const lines = text.split("\n");
  const sections = { header: [] };
  let currentSection = "header";

  for (const line of lines) {
    const trimmed = line.trim();
    let matched = false;
    for (const [name, pattern] of sectionPatterns) {
      if (pattern.test(trimmed)) {
        currentSection = name;
        if (!sections[currentSection]) sections[currentSection] = [];
        matched = true;
        break;
      }
    }
    if (!matched) sections[currentSection].push(line);
  }

  const headerText    = (sections.header || []).join("\n");
  const emailMatch    = headerText.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  const phoneMatch    = headerText.match(/(\+91[\s-]?)?[6-9]\d{9}|\(\d{3}\)\s?\d{3}-\d{4}/);
  const linkedInMatch = headerText.match(/linkedin\.com\/in\/[\w-]+/i);
  const githubMatch   = headerText.match(/github\.com\/[\w-]+/i);
  const nameMatch     = (sections.header || []).find(l =>
    l.trim().length > 2 && l.trim().length < 60 && !l.includes("@") && !l.match(/\d{10}/)
  );

  return {
    name:     nameMatch?.trim() ?? "",
    email:    emailMatch?.[0] ?? "",
    phone:    phoneMatch?.[0] ?? "",
    linkedin: linkedInMatch?.[0] ?? "",
    github:   githubMatch?.[0] ?? "",
    ...Object.fromEntries(
      Object.entries(sections)
        .filter(([k]) => k !== "header")
        .map(([k, v]) => [k, v.join("\n").trim()])
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI PROMPT — returns FULL structured resume, not just rewrites
// ─────────────────────────────────────────────────────────────────────────────

function buildPrompt(segments, job, matchedSkills, missingSkills, userExperience) {
  return `You are an expert ATS resume writer. Rewrite this resume to perfectly target the job below.

STRICT RULES — NEVER BREAK:
1. Do NOT invent employers, job titles, degrees, or dates.
2. Do NOT add certifications not in the original.
3. Keep all company names, titles, and dates EXACTLY as-is.
4. You MAY: strengthen action verbs, add implied metrics, integrate missing keywords naturally.
5. Every bullet MUST start with a strong past-tense action verb.
6. Return ONLY valid JSON — no markdown fences, no text outside JSON.

JOB TARGET:
Title: ${job.title}
Company: ${job.company ?? "Not specified"}
Required experience: ${userExperience ?? "?"}+ years

KEYWORDS IN RESUME (keep these visible): ${matchedSkills.slice(0, 10).join(", ")}
KEYWORDS MISSING (add naturally if background supports): ${missingSkills.slice(0, 5).join(", ")}

USER'S RESUME:
${segments.name} | ${segments.email} | ${segments.phone} | ${segments.linkedin} | ${segments.github}

SUMMARY: ${segments.summary || "(none)"}
EXPERIENCE: ${segments.experience || "(none)"}
PROJECTS: ${segments.projects || "(none)"}
SKILLS: ${segments.skills || "(none)"}
EDUCATION: ${segments.education || "(none)"}
CERTIFICATIONS: ${segments.certifications || "(none)"}

JOB DESCRIPTION (first 1000 chars):
${(job.description ?? "").slice(0, 1000)}

RETURN EXACTLY THIS JSON (all fields required, empty array if no data):
{
  "contact": {
    "name": "full name",
    "email": "email",
    "phone": "phone",
    "location": "city, country or empty string",
    "linkedin": "linkedin.com/in/... or empty string",
    "github": "github.com/... or empty string"
  },
  "summary": "2-3 sentence summary targeting this exact role",
  "experience": [
    {
      "company": "Company Name (unchanged)",
      "title": "Job Title (unchanged)",
      "startDate": "Mon YYYY (unchanged)",
      "endDate": "Mon YYYY or Present (unchanged)",
      "location": "City if present or empty string",
      "bullets": ["Action verb + achievement + metric if possible"]
    }
  ],
  "projects": [
    {
      "name": "Project Name",
      "url": "url or empty string",
      "date": "date or empty string",
      "bullets": ["bullet 1", "bullet 2"]
    }
  ],
  "skills": {
    "Languages": ["skill1", "skill2"],
    "Frameworks": ["skill1"],
    "Databases": ["skill1"],
    "Tools & DevOps": ["skill1"],
    "Other": ["skill1"]
  },
  "education": [
    {
      "institution": "College Name",
      "degree": "Degree",
      "field": "Field of Study",
      "startDate": "YYYY",
      "endDate": "YYYY",
      "gpa": "GPA or empty string",
      "location": "City or empty string"
    }
  ],
  "certifications": ["cert1"],
  "optimizationNotes": [
    "Specific change and exact reason. E.g. Added Docker to skills — appeared 4x in JD"
  ]
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYZE ROUTE
// ─────────────────────────────────────────────────────────────────────────────

router.post("/analyze/:jobSourceId", authMiddleware, async (req, res) => {
  try {
    const userId      = req.userId;
    const { jobSourceId } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const resume = await db.query.resumes.findFirst({ where: eq(resumes.userId, userId) });
    if (!resume?.text || !resume.isResumeParsed) {
      return res.status(400).json({ error: "no_resume", message: "Please upload and parse your resume first." });
    }

    const jobMatch = await db.query.jobMatches.findFirst({
      where: and(eq(jobMatches.userId, userId), eq(jobMatches.jobSourceId, jobSourceId)),
    });
    if (!jobMatch) return res.status(404).json({ error: "Job match not found" });

    const job = await db.query.jobs.findFirst({ where: eq(jobs.sourceJobId, jobSourceId) });
    if (!job) return res.status(404).json({ error: "Job not found" });

    const { score, breakdown } = computeATSScore(resume.text, jobMatch.matchedSkills ?? [], jobMatch.missingSkills ?? []);

    const cachedOpt = await db.query.resumeOptimizations.findFirst({
      where: and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.jobSourceId, jobSourceId)),
    });

    return res.json({
      scoreBefore:      score,
      scoreAfter:       cachedOpt?.scoreAfter ?? null,
      breakdown,
      matchedSkills:    jobMatch.matchedSkills ?? [],
      missingSkills:    jobMatch.missingSkills ?? [],
      matchPercent:     jobMatch.matchPercent,
      job:              { title: job.title, company: job.company },
      alreadyOptimized: cachedOpt?.status === "completed",
      optimizedResume:  cachedOpt?.status === "completed" ? JSON.parse(cachedOpt.optimizedJson) : null,
      keywordsAdded:    cachedOpt?.keywordsAdded ?? [],
    });
  } catch (err) {
    console.error("[resume/analyze]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OPTIMIZE ROUTE
// ─────────────────────────────────────────────────────────────────────────────

router.post("/optimize/:jobSourceId", authMiddleware, async (req, res) => {
  try {
    const userId      = req.userId;
    const { jobSourceId } = req.params;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return res.status(404).json({ error: "User not found" });
    if ((user.credits ?? 0) < 1) {
      return res.status(402).json({ error: "insufficient_credits", message: "You need at least 1 credit." });
    }

    const existing = await db.query.resumeOptimizations.findFirst({
      where: and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.jobSourceId, jobSourceId)),
    });

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (existing?.status === "completed" && existing.createdAt > oneDayAgo) {
      const parsed = JSON.parse(existing.optimizedJson);
      return res.json({
        cached:            true,
        scoreBefore:       existing.scoreBefore,
        scoreAfter:        existing.scoreAfter,
        optimizedResume:   parsed,
        keywordsAdded:     existing.keywordsAdded ?? [],
        optimizationNotes: parsed.optimizationNotes ?? [],
      });
    }

    const [resume, job, jobMatch] = await Promise.all([
      db.query.resumes.findFirst({ where: eq(resumes.userId, userId) }),
      db.query.jobs.findFirst({ where: eq(jobs.sourceJobId, jobSourceId) }),
      db.query.jobMatches.findFirst({
        where: and(eq(jobMatches.userId, userId), eq(jobMatches.jobSourceId, jobSourceId)),
      }),
    ]);

    if (!resume?.text || !resume.isResumeParsed) {
      return res.status(400).json({ error: "no_resume", message: "Upload your resume first." });
    }
    if (!job)      return res.status(404).json({ error: "Job not found" });
    if (!jobMatch) return res.status(404).json({ error: "Job match not found" });

    const matchedSkills = jobMatch.matchedSkills ?? [];
    const missingSkills = jobMatch.missingSkills ?? [];
    const { score: scoreBefore } = computeATSScore(resume.text, matchedSkills, missingSkills);

    const segments = segmentResume(resume.text);
    const prompt   = buildPrompt(segments, job, matchedSkills, missingSkills, user.experience);

    let optRow = existing;
    if (!optRow) {
      const [inserted] = await db.insert(resumeOptimizations)
        .values({ userId, jobSourceId, scoreBefore, status: "processing", keywordsMatched: matchedSkills, keywordsMissing: missingSkills })
        .returning();
      optRow = inserted;
    } else {
      await db.update(resumeOptimizations)
        .set({ status: "processing", scoreBefore, updatedAt: new Date() })
        .where(eq(resumeOptimizations.id, optRow.id));
    }

    
const result = await generateText({
  model: openrouter(process.env.OPENROUTER_MODEL), // "openai/gpt-5-nano"
  messages: [
    { role: "user", content: prompt }
  ],
  temperature: 0.2,
  maxTokens: 3000,
});

    
    const rawContent   = result.text
    const inputTokens  = result.usage?.inputTokens ?? 0;
    const outputTokens = result.usage?.outputTokens ?? 0;

    let parsed;
    console.log("parsedOne", rawContent);
    try {
      parsed = JSON.parse(rawContent.replace(/```json|```/g, "").trim());
      //console.log("parsedTwo", parsed);
    } catch {
      await db.update(resumeOptimizations)
        .set({ status: "failed", errorMessage: "AI returned invalid JSON", updatedAt: new Date() })
        .where(eq(resumeOptimizations.id, optRow.id));
      return res.status(500).json({ error: "AI returned invalid output. Credits not charged." });
    }

    // Validate — remove any hallucinated experience entries
    parsed.experience = (parsed.experience ?? []).filter(exp => {
      const check = (exp.company ?? "").toLowerCase().trim().slice(0, 15);
      return !check || resume.text.toLowerCase().includes(check);
    });

    const reconstructed = [
      parsed.summary ?? "",
      ...(parsed.experience ?? []).flatMap(e => e.bullets ?? []),
      ...Object.values(parsed.skills ?? {}).flat(),
    ].join("\n");

    const keywordsAdded    = missingSkills.filter(sk => reconstructed.toLowerCase().includes(sk.toLowerCase()));
    const newMatchedSkills = [...matchedSkills, ...keywordsAdded];
    const newMissingSkills = missingSkills.filter(sk => !keywordsAdded.includes(sk));
    const { score: scoreAfter } = computeATSScore(reconstructed, newMatchedSkills, newMissingSkills);

    await Promise.all([
      db.update(users).set({ credits: sql`${users.credits} - 1` }).where(eq(users.id, userId)),
      db.insert(aiUsageLogs).values({ userId, feature: "resume_optimize", model: MODEL, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }),
      db.update(resumeOptimizations)
        .set({ status: "completed", scoreAfter, optimizedJson: JSON.stringify(parsed), keywordsAdded, updatedAt: new Date() })
        .where(eq(resumeOptimizations.id, optRow.id)),
    ]);

    return res.json({
      cached:            false,
      scoreBefore,
      scoreAfter,
      optimizedResume:   parsed,
      keywordsAdded,
      optimizationNotes: parsed.optimizationNotes ?? [],
    });

  } catch (err) {``
    console.error("[resume/optimize]", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;