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
import { AppError } from "../lib/AppError.js";


const MAX_SIZE = 500 * 1024;

const TIER_LIMITS = {
  free: 10000,
  pro: 200000,
  enterprise: Infinity,
};

export async function getUserProfileService(userId) {
  if(!userId){
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



export async function updateUserProfileService(userId, data) {

  const updateData = { ...data };

  // ✅ Only validate if skills is present
  if ("skills" in data) {
    if (!Array.isArray(data.skills)) {
     throw new AppError("Invalid skills format", 400);
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


export async function uploadResumeService(userId, file, requestId) {
  //console.log("api has been called",Date.now())
  if (!file) {
    throw new AppError("No File uploaded",404)
  }

  if (file.size > MAX_SIZE) {
    throw new AppError("Resume must be under 500Kb",400)
  }
   const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new AppError("user not found",404)
    }
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

const usage = await db
  .select({
    total: sql`COALESCE(SUM(${aiUsageLogs.totalTokens}),0)`
  })
  .from(aiUsageLogs)
  .where(
    and(eq(aiUsageLogs.userId, userId), gt(aiUsageLogs.createdAt, last24h))
  );

if (Number(usage[0].total) >= TIER_LIMITS[user.tier] ?? TIER_LIMITS.free) {
  throw new AppError( "Daily limit reached for your plan", 429);
}

  const fileName = file.originalname.toLowerCase();
  const safeName = fileName.replace(/[^a-z0-9.\-_]/gi, "_");

  const isPDF = safeName.endsWith(".pdf");
  const isDOCX = safeName.endsWith(".docx");

  if (!isPDF && !isDOCX) {
    throw  new AppError( "Only PDF or DOCX supported",400 )
  }

  await fs.mkdir(uploadDir, { recursive: true });

  const uniqueName = `${userId}_${Date.now()}_${safeName}`;
  const filePath = path.join(uploadDir, uniqueName);

  await fs.writeFile(filePath, file.buffer);
  

  
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
          jobId: userId,
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



    // 2️⃣ Get resume
    const resume = await db.query.resumes.findFirst({
      where: eq(resumes.userId, userId),
    });

    if (!resume?.text) {
      throw new Error("Resume text not found. Upload resume first.");
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

       logger.error("Resume AI parsing failed", { userId, requestId, error: err.message });

  try {
    await db.update(resumes)
      .set({
        status: "failed",
        errorMessage: err.message || "Unknown error"
      })
      .where(eq(resumes.userId, userId));
  } catch (dbErr) {
    logger.error("CRITICAL: Failed to update resume status to failed", {
      userId,
      dbError: dbErr.message
    });
  }

  throw err;

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

       // update status so frontend stops polling
    await db.update(resumes)
      .set({
        status: "failed",
        errorMessage: err.message || "Unknown error"
      })
      .where(eq(resumes.userId, userId));

    logger.error("Resume AI parsing failed", {
      userId,
      requestId,
      error: err.message
    });

 

    throw err;
  }
}


