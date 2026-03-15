import { db } from "../db/index.js";
import { users, userJobApplications, resumes,aiUsageLogs } from "../db/schema.js";
import { and,eq,gt,sql, desc } from "drizzle-orm";
import { generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { ResumeSchema } from "../schemas/user.schema.js";
import { normalizeSkills } from "../lib/utils.js";
import { resumeParseQueue } from "../queue/resumeParseQueue.js";
import fs from "fs/promises";
import path from "path";
import logger from "../logger/logger.js";

const MAX_SIZE = 500 * 1024;

const TIER_LIMITS = {
  free: 10000,
  pro: 200000,
  enterprise: Infinity,
};

export async function getUserProfileService(userId) {
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
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!result.length) {
    return {
      success: false,
      error: "User not found",
    };
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

  // 3️⃣ Count job applications
  const applicationsCountResult = await db
    .select({
      count: sql`count(*)`,
    })
    .from(userJobApplications)
    .where(eq(userJobApplications.userId, userId));

  const applicationsCount = Number(applicationsCountResult[0]?.count ?? 0);

  // 4️⃣ Final response
  return {
    success: true,
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

export async function getUserJobApplicationsService(userId) {
  const jobs = await db
    .select({
      id: userJobApplications.id,
      jobUrl: userJobApplications.jobUrl,
      jobTitle: userJobApplications.jobTitle,
      company: userJobApplications.company,
      source: userJobApplications.source,
      status: userJobApplications.status,
      notes: userJobApplications.notes,
      createdAt: userJobApplications.createdAt,
      statusUpdatedAt: userJobApplications.statusUpdatedAt,
    })
    .from(userJobApplications)
    .where(eq(userJobApplications.userId, userId))
    .orderBy(desc(userJobApplications.createdAt));

  return jobs;
}

export async function updateUserProfileService(userId, data) {
  const updateData = { ...data };

  // ✅ Only validate if skills is present
  if ("skills" in data) {
    if (!Array.isArray(data.skills)) {
      throw {
        status: 400,
        message: "Invalid skills format..",
      };
    }

    // ✅ REPLACE + dedupe
 updateData.skills = normalizeSkills(data.skills);
  }

  const result = await db
    .update(users)
    .set(updateData)
    .where(eq(users.id, userId))
    .returning();

  return result[0];
}
// ================== RESUME UPLOAD ==================



const uploadDir = path.join(process.cwd(), "uploads/resumes");

// export async function uploadResumeService(userId, file, requestId) {
// //console.log("api satrted time", Date.now().getTime());
//   if (!file) {
//     throw { status: 400, message: "No resume uploaded" };
//   }
// if (file.size > MAX_SIZE) {
//   throw { status: 413, message: "Resume must be under 500KB" };
// }

// const user = await db.query.users.findFirst({
//   where: eq(users.id, userId),
// });

// if (!user) {
//   throw { status: 404, message: "User not found" };
// }

// const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

// console.time("get usage");
// const usage = await db
//   .select({
//     total: sql`COALESCE(SUM(${aiUsageLogs.totalTokens}),0)`,
//   })
//   .from(aiUsageLogs)
//   .where(
//     and(eq(aiUsageLogs.userId, userId), gt(aiUsageLogs.createdAt, last24h)),
//   );
//   console.timeEnd("get usage");

// const totalUsage = Number(usage[0].total);
// logger.info("totalUsage", totalUsage);

// if (totalUsage >= TIER_LIMITS[user.tier]) {
//   throw {
//     status: 429,
//     message: "Daily limit reached for your plan",
//   };
// }


// const fileName = file.originalname.toLowerCase();
// const safeName = fileName.replace(/[^a-z0-9.\-_]/gi, "_");

// const isPDF = safeName.endsWith(".pdf");
// const isDOCX = safeName.endsWith(".docx");

// if (!isPDF && !isDOCX) {
//   throw { status: 415, message: "Only PDF or DOCX supported" };
// }

// await fs.mkdir(uploadDir, { recursive: true });

// const uniqueName = `${userId}_${Date.now()}_${safeName}`;
// const filePath = path.join(uploadDir, uniqueName);

// await fs.writeFile(filePath, file.buffer);

// const existingResume = await db.query.resumes.findFirst({
//   where: eq(resumes.userId, userId)
// });

// if (existingResume) {
//   await db.update(resumes)
//     .set({
//       pendingFileName: fileName,
//       fileType: isPDF ? "pdf" : "docx",
//       isResumeParsed: false
//     })
//     .where(eq(resumes.userId, userId));

// } else {
//   await db.insert(resumes).values({
//     userId,
//     pendingFileName: fileName,
//     fileType: isPDF ? "pdf" : "docx",
//     isResumeParsed: false
//   });
// }

// await resumeParseQueue.add(
//   "parseResume",
//   {
//     userId,
//     filePath,
//     fileType: isPDF ? "pdf" : "docx",
//     requestId
//   },
//   {
//     attempts: 3,
//     removeOnComplete: true
//   }
// );
// logger.info("parse resume queue added",{
//   requestId,
//   userId
// });

//   return { status: "processing" };
// }

export async function uploadResumeService(userId, file, requestId) {
  console.log("api has been called",Date.now())
  if (!file) {
    throw { status: 400, message: "No resume uploaded" };
  }

  if (file.size > MAX_SIZE) {
    throw { status: 413, message: "Resume must be under 500KB" };
  }

  const fileName = file.originalname.toLowerCase();
  const safeName = fileName.replace(/[^a-z0-9.\-_]/gi, "_");

  const isPDF = safeName.endsWith(".pdf");
  const isDOCX = safeName.endsWith(".docx");

  if (!isPDF && !isDOCX) {
    throw { status: 415, message: "Only PDF or DOCX supported" };
  }

  await fs.mkdir(uploadDir, { recursive: true });

  const uniqueName = `${userId}_${Date.now()}_${safeName}`;
  const filePath = path.join(uploadDir, uniqueName);
console.time("writedisk")
  await fs.writeFile(filePath, file.buffer);
  console.timeEnd("writedisk")

  
  // push job immediately
  await resumeParseQueue.add(
    "parseResume",
    {
      userId,
      filePath,
      fileName:fileName,
      fileType: isPDF ? "pdf" : "docx",
      requestId
    },
    {
      removeOnComplete: true,
      removeOnFail: true
    }
  );

  return { status: "processing" };
}

export async function parseResumeWithAIService(userId, requestId) {

  try {

    logger.info("Resume AI parsing service started", {
      userId,
      requestId
    });

    // 1️⃣ Get user
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error("User not found");
    }

    // 2️⃣ Get resume
    const resume = await db.query.resumes.findFirst({
      where: eq(resumes.userId, userId),
    });

    if (!resume?.text) {
      throw new Error("Resume text not found. Upload resume first.");
    }

    // 3️⃣ Check usage limit
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const usage = await db
      .select({
        total: sql`COALESCE(SUM(${aiUsageLogs.totalTokens}),0)`,
      })
      .from(aiUsageLogs)
      .where(
        and(eq(aiUsageLogs.userId, userId), gt(aiUsageLogs.createdAt, last24h)),
      );

    if (Number(usage[0].total) >= TIER_LIMITS[user.tier]) {
      throw new Error("Daily AI usage limit reached");
    }

    // 4️⃣ Call AI
    let object;
    let aiUsage;

    try {

      const result = await generateObject({
        model: openrouter(process.env.OPENROUTER_MODEL),
        schema: ResumeSchema,
        temperature: 0,
        prompt: 
        `
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
- programming languages
- frameworks
- libraries
- databases
- cloud platforms
- devops tools
- APIs
- protocols
- messaging systems
- testing tools
- CI/CD tools

Examples of valid skills:
python
java
javascript
react
node.js
express
postgresql
mysql
mongodb
redis
docker
kubernetes
aws
gcp
rest api
graphql

STRICTLY EXCLUDE:
communication
leadership
management
teamwork
problem solving
documentation
planning
coordination
customer support
inventory management

If a skill is ambiguous (example: "design") → exclude it unless it clearly refers to a technical concept like:
- system design
- ui design
- database design

Skills must:
- be lowercase
- be concise
- contain no duplicates
- be explicitly mentioned in the resume

========================
LOCATION RULES
========================

Return location as:

city
or

city, country

Examples:
hyderabad
hyderabad, india
london, uk

If not present → null

========================
BIO RULES
========================

Generate a short professional summary using ONLY factual information from the resume.

Rules:
- 2–3 sentences maximum
- focus only on technical background
- do NOT include soft skills
- do NOT exaggerate experience
- do NOT add technologies not present in the resume

========================
FINAL OUTPUT
========================

Return only valid structured output matching the schema.

Do NOT include explanations.

========================
RESUME
========================

${resume.text}
        `
      });

      object = result.object;
      aiUsage = result.usage;

    } catch (err) {

      if (err?.message?.includes("credits") || err?.statusCode === 402) {
        throw new Error("AI service temporarily unavailable");
      }

      throw new Error("AI resume parsing failed");
    }

    if (!object) {
      throw new Error("Invalid AI response");
    }

    logger.info("AI parsing completed", {
      userId,
      requestId
    });

    // 5️⃣ Normalize result
    const cleanedData = {
      name: object.name,
      skills: normalizeSkills(object.skills),
      location: object.location,
      experience: object.experience,
      bio: object.bio,
    };

    // 6️⃣ Transaction: update everything safely
    await db.transaction(async (tx) => {

      await tx.update(users)
        .set(cleanedData)
        .where(eq(users.id, userId));

      await tx.update(resumes)
        .set({
          fileName: resume.pendingFileName,
          pendingFileName: null,
          isResumeParsed: true,
          status: "completed",
          errorMessage: null
        })
        .where(eq(resumes.userId, userId));

      await tx.insert(aiUsageLogs).values({
        userId,
        feature: "resume_parse",
        model: process.env.OPENROUTER_MODEL,
        inputTokens: aiUsage.inputTokens,
        outputTokens: aiUsage.outputTokens,
        totalTokens: aiUsage.totalTokens,
      });

    });

    logger.info("Resume AI parsing completed successfully", {
      userId,
      requestId
    });

    return cleanedData;

  } catch (err) {

    logger.error("Resume AI parsing failed", {
      userId,
      requestId,
      error: err.message
    });

    // update status so frontend stops polling
    await db.update(resumes)
      .set({
        status: "failed",
        errorMessage: err.message || "Unknown error"
      })
      .where(eq(resumes.userId, userId));

    throw err;
  }
}


