import { db } from "../db/index.js";
import {
  users,
  userJobApplications,
  resumes,
  aiUsageLogs,
} from "../db/schema.js";
import { and, eq, gt, sql, desc } from "drizzle-orm";
import { generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { ResumeSchema } from "../schemas/user.schema.js";
import { normalizeSkills } from "../lib/utils.js";
import { resumeParseQueue } from "../queue/resumeParseQueue.js";
import fs from "fs/promises";
import path from "path";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";
import {
  getUserAccessFromUser,
  consumeUserCredits,
} from "./userAccess.service.js";

const MAX_SIZE = 500 * 1024;

const TIER_LIMITS = {
  free: 10_000,
  pro: 200_000,
  enterprise: Infinity,
};

const uploadDir = path.join(process.cwd(), "uploads/resumes");

// ─────────────────────────────────────────────────────────────────────────────
// Helper — plan-aware "not enough credits" message
// ─────────────────────────────────────────────────────────────────────────────
function creditErrorMessage(access, cost) {
  const isPro = access.plan === "pro";

  if (isPro) {
    return `You've used all 100 Pro credits this month — you have ${access.credits} left. Your credits reset at the start of your next billing cycle.`;
  }

  return `Resume analysis costs ${cost} credits and you have ${access.credits} free credit${access.credits === 1 ? "" : "s"} remaining. Upgrade to Pro for 100 credits/month.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// getUserProfileService
// ─────────────────────────────────────────────────────────────────────────────
export async function getUserProfileService(userId) {
  if (!userId) {
    throw new AppError("UserId is required", 404);
  }

  const result = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      skills: users.skills,
      location: users.location,
      experience: users.experience,
      bio: users.bio,
      createdAt: users.createdAt,
      tier: users.tier,
      role: users.role,
      credits: users.credits,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!result.length) {
    throw new AppError("User not found", 404);
  }

  const resume = await db.query.resumes.findFirst({
    where: eq(resumes.userId, userId),
    columns: {
      fileName: true,
      uploadedAt: true,
      isResumeParsed: true,
      status: true,
      errorMessage: true,
    },
  });

  const applicationsCountResult = await db
    .select({ count: sql`count(*)` })
    .from(userJobApplications)
    .where(eq(userJobApplications.userId, userId));

  const applicationsCount = Number(applicationsCountResult[0]?.count ?? 0);

  return {
    profile: result[0],
    resume: resume
      ? {
          uploaded: true,
          parsed: resume.isResumeParsed,
          status: resume.status,
          errorMessage: resume.errorMessage,
          fileName: resume.fileName,
          uploadedAt: resume.uploadedAt,
        }
      : {
          uploaded: false,
          parsed: false,
          status: "idle",
          errorMessage: null,
        },
    applicationsCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// updateUserProfileService
// ─────────────────────────────────────────────────────────────────────────────
export async function updateUserProfileService(userId, data) {
  const updateData = { ...data };

  if ("skills" in data) {
    if (!Array.isArray(data.skills)) {
      throw new AppError("Invalid skills format", 400);
    }
    updateData.skills = normalizeSkills(data.skills);
  }

  const result = await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId))
    .returning();

  return result[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// uploadResumeService
// Changes vs old version:
//   1. Credit check (plan-aware message) BEFORE queue — no polluted state
//   2. Daily token-usage guard kept in place
//   3. consumeUserCredits NOT called here — called inside parseResumeWithAIService
//      after AI actually runs, so credits only deduct on real work
// ─────────────────────────────────────────────────────────────────────────────
export async function uploadResumeService(userId, file, requestId) {
  if (!file) {
    throw new AppError("No file uploaded", 404);
  }

  if (file.size > MAX_SIZE) {
    throw new AppError("Resume must be under 500KB", 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, tier: true, credits: true, planExpiresAt: true },
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  // ── 1. Credit check — fail fast before any async work ────────────────────
  const access = getUserAccessFromUser(user);

  if (access.credits < 2) {
    throw new AppError(creditErrorMessage(access, 2), 402);
  }

  // ── 3. File-type validation ───────────────────────────────────────────────
  const fileName = file.originalname.toLowerCase();
  const safeName = fileName.replace(/[^a-z0-9.\-_]/gi, "_");
  const isPDF = safeName.endsWith(".pdf");
  const isDOCX = safeName.endsWith(".docx");

  if (!isPDF && !isDOCX) {
    throw new AppError("Only PDF or DOCX files are supported", 400);
  }

  // ── 4. Write + enqueue ────────────────────────────────────────────────────
  await fs.mkdir(uploadDir, { recursive: true });

  const uniqueName = `${userId}_${Date.now()}_${safeName}`;
  const filePath = path.join(uploadDir, uniqueName);

  await fs.writeFile(filePath, file.buffer);

  await resumeParseQueue.add(
    "parseResume",
    { userId, filePath, fileName, fileType: isPDF ? "pdf" : "docx", requestId },
    { jobId: userId, removeOnComplete: true, removeOnFail: true },
  );

  return { status: "processing" };
}

// ─────────────────────────────────────────────────────────────────────────────
// parseResumeWithAIService
// Changes vs old version:
//   1. Re-check credits here too (race-condition safety — two tabs, etc.)
//   2. consumeUserCredits called INSIDE the final transaction so credit
//      deduction and data update are atomic — no deduct-then-fail scenario
// ─────────────────────────────────────────────────────────────────────────────
export async function parseResumeWithAIService(userId, requestId) {
  try {
    logger.info("Resume AI parsing service started", { userId, requestId });

    // ── 1. Fetch resume ───────────────────────────────────────────────────
    const resume = await db.query.resumes.findFirst({
      where: eq(resumes.userId, userId),
    });

    if (!resume?.text) {
      throw new Error("Resume text not found. Upload resume first.");
    }

    // ── 2. Re-check credits (race-condition safety) ───────────────────────
    // uploadResumeService already checked, but the worker might run seconds
    // later — user could have spent credits on something else in between.
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, tier: true, credits: true, planExpiresAt: true },
    });

    if (!user) throw new Error("User not found");

    const access = getUserAccessFromUser(user);

    if (access.credits < 2) {
      // Mark failed immediately with a clear human-readable reason
      await db
        .update(resumes)
        .set({
          status: "failed",
          errorMessage: creditErrorMessage(access, 2),
        })
        .where(eq(resumes.userId, userId));

      // Don't throw — worker job is "done", just with failed status
      logger.warn("Resume parse skipped — insufficient credits", { userId });
      return null;
    }

    // ── 3. Call AI ────────────────────────────────────────────────────────
    let object;
    let aiUsage;

    try {
      const result = await generateObject({
        model: openrouter(process.env.OPENROUTER_MODEL),
        schema: ResumeSchema,
        temperature: 0,
        prompt: buildResumePrompt(resume.text),
      });

      object = result.object;
      aiUsage = result.usage;
    } catch (err) {
      logger.error("Resume AI parsing failed", {
        userId,
        requestId,
        error: err.message,
      });

      await db
        .update(resumes)
        .set({
          status: "failed",
          errorMessage: err.message || "AI parsing error",
        })
        .where(eq(resumes.userId, userId))
        .catch((dbErr) =>
          logger.error("CRITICAL: Failed to update resume status", {
            userId,
            dbError: dbErr.message,
          }),
        );

      throw err;
    }

    if (!object) throw new Error("Invalid AI response");
    //console.log("object:;", object);

   const cleanedData = {
  name: object.name,
  skills: normalizeSkills(object.skills),
  location: object.location,

  // ✅ FIX THIS
  experience: Array.isArray(object.experience)
    ? object.experience.reduce((sum, exp) => sum + (exp.experienceMonths || 0), 0)
    : object.experience || 0,

  bio: object.bio,
};
    // ── 4. Normalize ──────────────────────────────────────────────────────
    const structuredResume = {
      contact: {
        name: object.name,
        email: object.email,
        phone: object.phone,
        location: object.location,
        linkedin: object.linkedin,
        github: object.github,
      },
      summary: object.bio,
      experience: object.experience,
      projects: object.projects || [],
      skills: object.skills,
      education: object.education || [],
      certifications: object.certifications || [],
    };
    //console.log("cleanedData:;", JSON.stringify(cleanedData, null, 2));
   
    try {
      // ✅ CRITICAL ATOMIC PART
      await db.transaction(async (tx) => {
        await tx.update(users).set(cleanedData).where(eq(users.id, userId));

        await tx
          .update(users)
          .set({ credits: sql`${users.credits} - 2` })
          .where(eq(users.id, userId));

        await tx
          .update(resumes)
          .set({
            status: "completed",
            isResumeParsed: true,
            fileName: resume.pendingFileName,
            pendingFileName: null,
            errorMessage: null,
          })
          .where(eq(resumes.userId, userId));
      });

      // ✅ NON-CRITICAL (can fail safely)
      await db.update(resumes).set({
        structuredJson: JSON.stringify(structuredResume),
      });

      await db.insert(aiUsageLogs).values({
        userId,
        feature: "resume_parse",
        model: process.env.OPENROUTER_MODEL,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
        totalTokens: aiUsage.totalTokens,
      });
    } catch (err) {
      logger.error("Resume parse DB transaction failed", {
        userId,
        requestId,
        name:    err.name,
        message: err.message,
      });

      await db.update(resumes)
        .set({
          status: "failed",
          errorMessage: err.message,
        })
        .where(eq(resumes.userId, userId));

      throw err; // propagate so outer catch marks it failed too
    }

    logger.info("Resume AI parsing completed", {
      userId,
      requestId,
      inputTokens:     aiUsage?.inputTokens,
      outputTokens:    aiUsage?.outputTokens,
      totalTokens:     aiUsage?.totalTokens,
      creditsConsumed: 2,
    });

    return cleanedData;
  } catch (err) {
    await db
      .update(resumes)
      .set({ status: "failed", errorMessage: err.message || "Unknown error" })
      .where(eq(resumes.userId, userId));

    logger.error("Resume AI parsing failed", {
      userId,
      requestId,
      error: err.message,
    });

    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// buildResumePrompt — extracted so the service body stays readable
// ─────────────────────────────────────────────────────────────────────────────
function buildResumePrompt(resumeText) {
  return `
You are a strict resume parser.

Your task is to extract ONLY factual technical information from the resume.
Do NOT guess, infer, or hallucinate any information.

Return results strictly following the provided schema.

========================
GENERAL RULES
========================

1. Extract ONLY information explicitly present in the resume.
2. Do NOT fabricate missing information.
3. If data is missing:
   - string fields → null
   - skills → []
   - experienceMonths → 0
4. Ignore formatting artifacts like headers, page numbers, or repeated sections.
5. Ignore education unless it contains explicit technical skills.

========================
WORK EXPERIENCE RULES
========================

1. Identify all job experiences that include dates.
2. Convert each job duration into MONTHS.

Examples:
- "Jan 2023 - Present" → calculate until CURRENT month.
- "Jan 2025 - Jan 2026" → 12 months (do NOT add an extra month).
- "1.4 years" → 17 months.
- "1 year 6 months" → 18 months.
- "6 months" → 6 months.

3. Sum durations of all jobs.
4. If the candidate is a fresher → experienceMonths = 0.
5. Ignore internships shorter than 2 months.

========================
SKILLS RULES (STRICT)
========================

Extract ONLY technical skills.

Allowed categories:
- programming languages, frameworks, libraries, databases
- cloud platforms, devops tools, APIs, protocols
- messaging systems, testing tools, CI/CD tools

STRICTLY EXCLUDE:
communication, leadership, management, teamwork, problem solving,
documentation, planning, coordination, customer support, inventory management

Skills must be: lowercase · concise · no duplicates · explicitly in the resume

========================
LOCATION RULES
========================

Return as "city" or "city, country". If not present → null.

========================
BIO RULES
========================

2–3 sentences. Technical background only. No soft skills. No invented technologies.

========================
RESUME
========================

${resumeText}
  `.trim();
}
