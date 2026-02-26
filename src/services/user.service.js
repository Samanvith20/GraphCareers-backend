import { db } from "../db/index.js";
import { users, userJobApplications, resumes,aiUsageLogs } from "../db/schema.js";
import { and,eq,gt,sql, desc } from "drizzle-orm";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { ResumeSchema } from "../schemas/user.schema.js";
import { normalizeSkills } from "../lib/utils.js";

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
          fileName: resume.fileName,
          uploadedAt: resume.uploadedAt,
        }
      : {
          uploaded: false,
          parsed: false,
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
export async function uploadResumeService(userId, file) {
  if (!file) {
    throw { status: 400, message: "No resume uploaded" };
  }

  if (file.size > MAX_SIZE) {
    throw { status: 413, message: "Resume must be under 500KB" };
  }

  const fileName = file.originalname.toLowerCase();
  const isPDF = fileName.endsWith(".pdf");
  const isDOCX = fileName.endsWith(".docx");

  if (!isPDF && !isDOCX) {
    throw { status: 415, message: "Only PDF or DOCX supported" };
  }

  let text = "";

  if (isPDF) {
    const result = await extractText(new Uint8Array(file.buffer));
    console.log("pdfresult::",result?.text)
    if (typeof result?.text === "string") {
  text = result.text;
} else if (Array.isArray(result?.text)) {
  text = result.text.join(" ");
} else {
  text = "";
}

text = text.trim();
  }

  if (isDOCX) {
    const parsed = await mammoth.extractRawText({ buffer: file.buffer });
    text = parsed.value.trim();
  }

  text = text.replace(/\s+/g, " ");

  if (!text || text.length < 50) {
    throw {
      status: 400,
      message: "Could not extract sufficient text from resume",
    };
  }

  const existing = await db.query.resumes.findFirst({
    where: eq(resumes.userId, userId),
  });

  if (existing) {
    await db
      .update(resumes)
      .set({
         pendingFileName: fileName,
        fileType: isPDF ? "pdf" : "docx",
        text,
        uploadedAt: new Date(),
      })
      .where(eq(resumes.userId, userId));
  } else {
    await db.insert(resumes).values({
      userId,
       pendingFileName: fileName,
      fileType: isPDF ? "pdf" : "docx",
      text,
      uploadedAt: new Date(),
    });
  }

  return { textLength: text.length };
}

export async function parseResumeWithAIService(userId) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  const resume = await db.query.resumes.findFirst({
    where: eq(resumes.userId, userId),
  });

  if (!resume?.text) {
    throw {
      status: 400,
      message: "No resume text found. Upload resume first.",
    };
  }

  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const usage = await db
    .select({
      total: sql`COALESCE(SUM(${aiUsageLogs.totalTokens}),0)`,
    })
    .from(aiUsageLogs)
    .where(
      and(eq(aiUsageLogs.userId, userId), gt(aiUsageLogs.createdAt, last24h)),
    );

  if (usage[0].total >= TIER_LIMITS[user.tier]) {
    throw {
      status: 429,
      message: "Daily  limit reached for your plan ",
    };
  }

  const { object, usage: aiUsage } = await generateObject({
    model: openrouter(process.env.OPENROUTER_MODEL),
    schema: ResumeSchema,
    temperature: 0.2,
    
    prompt:`
    You are a resume parser.

Your task is to extract ONLY TECHNICAL INFORMATION.
Follow the rules strictly. Do not make assumptions.

========================
WORK EXPERIENCE RULES
========================

1. Identify ALL work experience entries that contain dates.
2. Convert each job duration into MONTHS:
   - "Jan 2023 - Present" → calculate until the CURRENT month only
   - "Jan 2025 - Jan 2026" → 12 months (do NOT add extra month)
   - "1.4 years" → 17 months
   - "1 year 6 months" → 18 months
   - "6 months" → 6 months
3. If a job has ended, DO NOT count the present month.
4. Sum ALL job durations.
5. If the user is a fresher, return experienceMonths = 0.

========================
SKILLS RULES (VERY IMPORTANT)
========================

Extract ONLY technical skills.

❌ DO NOT include soft skills, business skills, or generic words.
❌ DO NOT include responsibilities or job descriptions.
❌ DO NOT infer skills that are not explicitly mentioned.

STRICTLY EXCLUDE skills like (this list is NOT exhaustive):
- communication
- management
- leadership
- inventory
- teamwork
- collaboration
- problem solving
- decision making
- customer handling
- documentation
- planning
- analysis (unless clearly technical, e.g. "data analysis")
- design (unless clearly technical, e.g. "system design", "ui design")

✅ INCLUDE ONLY technical skills such as:
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

All skills must:
- be lowercase
- be concise
- be technical only
- be explicitly present in the resume

If a skill is ambiguous and could be soft or non-technical,
❗ DO NOT include it.

========================
OTHER FIELD RULES
========================

- Location: "city" or "city, country"
- Bio: 2–3 professional sentences describing technical background only
- Do NOT include soft skills in bio
- Do NOT exaggerate or infer experience

========================
UNKNOWN DATA HANDLING
========================

If any field is unknown:
- strings → null
- skills → []
- experienceMonths → 0

Resume:
${resume.text}

    `
  });

  const cleanedData = {
    name: object.name,
    skills: normalizeSkills(object.skills),
    location: object.location,
    experience: object.experience,
    bio: object.bio,
  };

  await db.update(users).set(cleanedData).where(eq(users.id, userId));
  await db.update(resumes).set({
  fileName: resume.pendingFileName, // 👈 activate
  pendingFileName: null,
  isResumeParsed: true,
})
.where(eq(resumes.userId, userId));

  await db.insert(aiUsageLogs).values({
    userId,
    feature: "resume_parse",
    model: process.env.OPENROUTER_MODEL,
    inputTokens: aiUsage.inputTokens,
    outputTokens: aiUsage.outputTokens,
    totalTokens: aiUsage.totalTokens,
  });

  return cleanedData;
}


