import { db } from "../db/index.js";
import { users, jobMatches, resumes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getMatchedJobsService } from "../services/jobs.service.js";
import { computeTargetedTrends } from "../services/targetedTrend.service.js";
import { optimizeResumeForJob } from "../services/resumeOptimizer.service.js";
import { randomUUID } from "crypto";

async function testFullFlow() {
  // 2ccab0cd-d724-4b89-adcb-f38d87451d7e
  const userId = "2ccab0cd-d724-4b89-adcb-f38d87451d7e";
  console.log(`\n=== STEP 1: Fetching User Profile ===`);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) {
    console.error("User not found!");
    process.exit(1);
  }
  console.log(`User found: ${user.name || userId}`);
  console.log(`User Skills: ${user.skills ? user.skills.join(", ") : "None"}`);

  console.log(`\n=== STEP 2: Finding Top Matched Jobs ===`);
  // Calling the service that talks to Neo4j
  const matchResult = await getMatchedJobsService({ userId });
  console.log(`Found ${matchResult.jobs.length} total matched jobs in Neo4j.`);
  
  if (matchResult.jobs.length === 0) {
    console.error("No jobs matched for this user.");
    process.exit(1);
  }

  // Pick the absolute best match
  const topJob = matchResult.jobs[0];
  console.log(`Top Job Match: ${topJob.title} at ${topJob.company} (Score: ${topJob.qualityScore}, Match: ${topJob.matchPercent}%)`);
  console.log(`Skills Matched: ${topJob.matchedSkills.join(", ")}`);
  console.log(`Skills Missing: ${topJob.missingSkills.join(", ")}`);

  console.log(`\n=== STEP 3: Getting Top Skills (Targeted Trends) for this Job ===`);
  const jobSourceId = String(topJob.id);
  const trends = await computeTargetedTrends([jobSourceId], "test-request");
  console.log(`Top Skills strictly required for this job context:`);
  trends.topSkills.forEach(s => console.log(` - ${s.skill} (${s.pct}%)`));

  console.log(`\n=== STEP 4: Running AI Resume Optimization ===`);
  // Wait a second to allow the background DB save in getMatchedJobsService to finish
  await new Promise(res => setTimeout(res, 1500));
  
  // Ensure the job is saved in jobMatches so optimization doesn't fail
  const [existingMatch] = await db.select().from(jobMatches).where(eq(jobMatches.jobSourceId, jobSourceId));
  if (!existingMatch) {
      await db.insert(jobMatches).values({
          userId,
          jobSourceId,
          matchedCount: topJob.matchedCount,
          requiredCount: topJob.totalRequired,
          matchPercent: topJob.matchPercent,
          score: topJob.qualityScore,
          matchedSkills: topJob.matchedSkills,
          missingSkills: topJob.missingSkills
      }).onConflictDoNothing();
      console.log(`(Force-saved job match in DB for optimization)`);
  }

  // Ensure a resume exists in the DB for this user
  let [resume] = await db.select().from(resumes).where(eq(resumes.userId, userId));
  if (!resume) {
    console.log(`(No resume found in DB. Inserting a mock master resume so AI can optimize it...)`);
    await db.insert(resumes).values({
      userId,
      status: "completed",
      structuredJson: JSON.stringify({
        contact: { name: user.name || "Test User", email: "test@example.com" },
        summary: "A passionate software engineer.",
        experience: [],
        projects: [],
        skills: {
          Languages: ["javascript", "typescript"],
          Frameworks: ["react.js", "node.js"],
          Databases: ["postgresql", "mongodb"],
          "Tools & DevOps": ["docker"]
        },
        education: []
      })
    });
    [resume] = await db.select().from(resumes).where(eq(resumes.userId, userId));
  } else if (!resume.structuredJson) {
    console.log(`(Resume exists but structuredJson is null. Updating it...)`);
    await db.update(resumes).set({
      status: "completed",
      structuredJson: JSON.stringify({
        contact: { name: user.name || "Test User", email: "test@example.com" },
        summary: "A passionate software engineer.",
        experience: [],
        projects: [],
        skills: {
          Languages: ["javascript", "typescript"],
          Frameworks: ["react.js", "node.js"],
          Databases: ["postgresql", "mongodb"],
          "Tools & DevOps": ["docker"]
        },
        education: []
      })
    }).where(eq(resumes.userId, userId));
    [resume] = await db.select().from(resumes).where(eq(resumes.userId, userId));
  }
  
  if (!resume || !resume.structuredJson) {
     console.error("Failed to mock resume! Aborting.");
     process.exit(1);
  } else {
     console.log("Verified resume exists for optimization.");
  }

  const requestId = randomUUID();
  console.log(`Starting AI Optimization process... (requestId: ${requestId})`);
  const result = await optimizeResumeForJob({ userId, jobSourceId, requestId });
  
  console.log(`\n=== STEP 5: Reviewing Accuracy & Final Output ===`);
  const { resumeOptimizations } = await import("../db/schema.js");
  const optRecords = await db.select().from(resumeOptimizations).where(eq(resumeOptimizations.id, result.optRecordId));
  
  if (optRecords.length > 0) {
    const rec = optRecords[0];
    console.log(`Optimization Status: ${rec.status}`);
    console.log(`Score Before: ${rec.scoreBefore}`);
    console.log(`Score After:  ${rec.scoreAfter}`);
    console.log(`Keywords Successfully Added:`, rec.keywordsAdded);
    console.log(`Keywords Still Missing:`, rec.keywordsMissing);
    console.log(`\n--- Optimized JSON Excerpt ---`);
    console.log(rec.optimizedJson ? rec.optimizedJson.substring(0, 800) + "...\n" : "No JSON generated.");
    
    const frontendPayload = {
      status: rec.status,
      scoreBefore: rec.scoreBefore,
      scoreAfter: rec.scoreAfter,
      keywordsAdded: rec.keywordsAdded,
      keywordsMissing: rec.keywordsMissing,
      optimizedResume: rec.optimizedJson ? JSON.parse(rec.optimizedJson) : null
    };
    
    import("fs").then(fs => {
        fs.writeFileSync("frontend_payload.json", JSON.stringify(frontendPayload, null, 2));
        console.log("Full frontend payload saved to frontend_payload.json");
    });
  }

  process.exit(0);
}

testFullFlow().catch(err => {
  console.error("Test flow failed:", err);
  process.exit(1);
});
