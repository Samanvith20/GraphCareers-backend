import { generateText, generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";
import { db } from "../db/index.js";
import { resumeOptimizations, jobMatches, users, resumes } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { computeTargetedTrends } from "./targetedTrend.service.js";
import { scoreResume, generateRecommendations } from "./resumeScore.service.js";
import { consumeUserCredits } from "./userAccess.service.js";

/**
 * Orchestrates the full resume optimization pipeline for a specific job match.
 *
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.jobSourceId
 * @param {string} params.requestId
 * @returns {Promise<object>}
 */
export async function optimizeResumeForJob({ userId, jobSourceId, requestId }) {
  // 1. Mark status as processing (upsert)
  const [optRecord] = await db
    .insert(resumeOptimizations)
    .values({ userId, jobSourceId, status: "processing" })
    .onConflictDoUpdate({
      target: [resumeOptimizations.userId, resumeOptimizations.jobSourceId],
      set: { status: "processing", errorMessage: null },
    })
    .returning();

  try {
    // 2. Fetch User & Master Resume
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    const [resume] = await db.select().from(resumes).where(eq(resumes.userId, userId));

    if (!resume || !resume.structuredJson) {
      throw new AppError("Master resume not found or not parsed. Please upload a resume first.", 400);
    }

    // 3. Fetch matched jobs on the same platform to build targeted trends
    // First, find what platform this job is on
    const [targetMatch] = await db.select().from(jobMatches).where(and(eq(jobMatches.userId, userId), eq(jobMatches.jobSourceId, jobSourceId)));
    if (!targetMatch) {
      throw new AppError("Job match not found for this user.", 404);
    }

    // 4. Compute targeted trends for this specific job
    const trends = await computeTargetedTrends([jobSourceId], requestId);

    // 5. Initial Scoring (Before Optimization)
    const experienceMonths = Array.isArray(resume.experience) 
        ? resume.experience.reduce((sum, exp) => sum + (exp.experienceMonths || 0), 0)
        : resume.experience || 0;
        
    const scoreBeforeOutput = scoreResume({
      resumeText: resume.rawText || JSON.stringify(resume.structuredJson),
      structuredJson: resume.structuredJson,
      platform: "targeted", // generic name for targeted trends
      trends,
      experienceMonths
    });

    // 6. Build LLM Context
    const context = buildOptimizationContext({
      masterResume: resume,
      trends,
      jobSourceId
    });

    // 7. Call LLM
    const { parsed, generationMs } = await callLLM({
      segments: resume.structuredJson,
      context,
      trends,
      requestId
    });

    // 8. Validate & Sanitize (No Hallucination Guarantee)
    const { sanitized, strippedCount } = validateAndSanitize(parsed, resume, requestId);

    // 9. Final Scoring (After Optimization)
    const scoreAfterOutput = scoreResume({
      resumeText: JSON.stringify(sanitized),
      structuredJson: sanitized,
      platform: "targeted",
      trends,
      experienceMonths
    });

    // 10. Compute Keywords added/missing
    const topTrendSkills = trends.topSkills.slice(0, 15).map(s => s.skill.toLowerCase());
    const initialText = (resume.rawText || JSON.stringify(resume.structuredJson)).toLowerCase();
    const finalText = JSON.stringify(sanitized).toLowerCase();

    const keywordsMatched = topTrendSkills.filter(s => finalText.includes(s));
    const keywordsMissing = topTrendSkills.filter(s => !finalText.includes(s));
    const keywordsAdded = keywordsMatched.filter(s => !initialText.includes(s));

    // 11. Transaction: Save & Consume Credits
    await db.transaction(async (tx) => {
      await tx
        .update(resumeOptimizations)
        .set({
          status: "completed",
          scoreBefore: scoreBeforeOutput.total,
          scoreAfter: scoreAfterOutput.total,
          scoreDetails: JSON.stringify({
            before: scoreBeforeOutput,
            after: scoreAfterOutput,
            recommendations: generateRecommendations({
              trends,
              resumeText: finalText,
              structuredJson: sanitized,
              platform: "targeted"
            })
          }),
          optimizedJson: JSON.stringify(sanitized),
          keywordsMatched,
          keywordsMissing,
          keywordsAdded,
          updatedAt: new Date()
        })
        .where(eq(resumeOptimizations.id, optRecord.id));

      await tx
        .update(users)
        .set({ credits: user.credits - 2 })
        .where(eq(users.id, userId));
    });

    logger.info("Targeted Resume Optimization completed", {
      requestId,
      userId,
      jobSourceId,
      scoreImprovement: scoreAfterOutput.total - scoreBeforeOutput.total,
      generationMs
    });

    return { success: true, optRecordId: optRecord.id };
  } catch (err) {
    logger.error("Resume optimization failed", { requestId, error: err.message });
    await db
      .update(resumeOptimizations)
      .set({ status: "failed", errorMessage: err.message, updatedAt: new Date() })
      .where(eq(resumeOptimizations.id, optRecord.id));
    throw err;
  }
}

function buildOptimizationContext({ masterResume, trends, jobSourceId }) {
  const topSkillsStr = trends.topSkills.map(s => `${s.skill} (${s.pct}%)`).join(", ");
  return `TARGET JOB: This resume is being tailored for a specific job matching profile. 
TRENDING SKILLS REQUIRED: ${topSkillsStr}
EXPERIENCE PREFERENCE: ${JSON.stringify(trends.experienceDistribution)}`;
}

async function callLLM({ segments, context, trends, requestId }) {
  const startTime = Date.now();
  const prompt = \`
You are an expert resume optimization specialist.

══════════════════════════════════════════════════
ABSOLUTE RULES — NEVER VIOLATE
══════════════════════════════════════════════════
1. NEVER invent employers, job titles, companies, or dates.
2. NEVER add skills or technologies not in the original resume.
3. NEVER fabricate metrics, percentages, or achievements.
4. NEVER add certifications not explicitly in the original.
5. Keep all company names, job titles, start/end dates EXACTLY as given.
6. You MAY: improve bullet phrasing, reorder skills, strengthen summary tone, surface existing keywords more prominently.
7. Return ONLY valid JSON — no markdown fences, no prose outside JSON.

══════════════════════════════════════════════════
CONTEXT FOR THIS SPECIFIC JOB
══════════════════════════════════════════════════
${context}

══════════════════════════════════════════════════
CANDIDATE RESUME
══════════════════════════════════════════════════
${JSON.stringify(segments, null, 2)}

══════════════════════════════════════════════════
OUTPUT — RETURN EXACTLY THIS JSON STRUCTURE
══════════════════════════════════════════════════
{
  "contact": {"name": "", "email": "", "phone": "", "location": "", "linkedin": "", "github": ""},
  "summary": "2-4 sentences. Platform-appropriate professional summary.",
  "experience": [
    {"company": "(unchanged)", "title": "(unchanged)", "startDate": "(unchanged)", "endDate": "(unchanged)", "location": "", "bullets": ["Action verb + specific impact"]}
  ],
  "projects": [
    {"name": "", "techStack": [], "url": "", "date": "", "bullets": [""]}
  ],
  "skills": {
    "Languages": [], "Frameworks": [], "Databases": [], "Tools & DevOps": [], "Other": []
  },
  "education": [
    {"institution": "", "degree": "", "field": "", "startDate": "", "endDate": "", "gpa": "", "location": ""}
  ],
  "certifications": [],
  "optimizationNotes": [
    "Specific change made and exact reason — e.g. Moved Docker to top of Tools section to align with job requirements."
  ]
}
\`;

  const { text } = await generateText({
    model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
    prompt,
    temperature: 0.2,
    maxTokens: 4000,
  });

  const generationMs = Date.now() - startTime;
  
  try {
    const cleanText = text.replace(/^\`\`\`json/m, '').replace(/^\`\`\`/m, '').trim();
    return { parsed: JSON.parse(cleanText), generationMs };
  } catch (e) {
    throw new AppError("AI returned invalid JSON — optimization failed", 500);
  }
}

function validateAndSanitize(parsed, originalResume, requestId) {
  let strippedCount = 0;
  const originalText = (originalResume.rawText || JSON.stringify(originalResume.structuredJson)).toLowerCase();

  // Very basic anti-hallucination: check if company names were invented
  if (parsed.experience && Array.isArray(parsed.experience)) {
    parsed.experience = parsed.experience.filter(exp => {
      if (!exp.company) return true;
      const compTarget = exp.company.substring(0, 10).toLowerCase();
      if (!originalText.includes(compTarget)) {
        strippedCount++;
        return false;
      }
      return true;
    });
  }

  // Same for skills: do not allow skills that are nowhere in original text
  if (parsed.skills) {
    for (const category of Object.keys(parsed.skills)) {
      if (Array.isArray(parsed.skills[category])) {
        parsed.skills[category] = parsed.skills[category].filter(skill => {
          if (!originalText.includes(skill.toLowerCase())) {
            strippedCount++;
            return false;
          }
          return true;
        });
      }
    }
  }

  if (strippedCount > 0) {
    logger.warn("Hallucinations stripped from AI output", { requestId, strippedCount });
  }

  return { sanitized: parsed, strippedCount };
  
}
  
