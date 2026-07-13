import dotenv from "dotenv";
dotenv.config();

import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getMatchedJobsService } from "../services/jobs.service.js";
import { getCareerInsightsService } from "../services/careerProgression.service.js";

async function testMatching() {
  try {
    const targetEmail = "samanvith2005@gmail.com";
    
    // 1. Get our test user
    let user = await db.query.users.findFirst({
      where: eq(users.email, targetEmail)
    });

    if (!user) {
      console.log(`User ${targetEmail} not found. Please run testEmail.js first to create it.`);
      process.exit(1);
    }

    console.log("=========================================");
    console.log(`TESTING FOR PROFILE: ${user.name}`);
    console.log(`Skills: ${user.skills.join(", ")}`);
    console.log(`Experience: ${user.experience / 12} years`);
    console.log("=========================================\n");

    // 2. Test Job Matching (with the new loosened filters)
    console.log("--> RUNNING: getMatchedJobsService (30-day window, 1-skill minimum)");
    const matchResult = await getMatchedJobsService({ userId: user.id });
    
    console.log(`\n✅ Found ${matchResult.jobs.length} jobs (Total).`);
    console.log(`✅ Average Match Percentage: ${matchResult.filters.avgMatch}%\n`);
    
    if (matchResult.jobs.length > 0) {
      console.log("TOP 3 JOBS FOUND:");
      matchResult.jobs.slice(0, 3).forEach((job, idx) => {
        console.log(`  ${idx + 1}. [${job.matchPercent}% Match] ${job.title} at ${job.company}`);
        console.log(`     Required Exp: ${job.minExp || 0}-${job.maxExp || "Any"} yrs`);
        console.log(`     Matched Skills: ${job.matchedSkills?.join(", ")}`);
        console.log(`     Missing Skills: ${job.missingSkills?.join(", ")}`);
      });
    }

    console.log("\n=========================================\n");

    // 3. Test Career Progression (with Jaccard overlap logic)
    console.log("--> RUNNING: getCareerInsightsService (Skill overlap pathing)");
    const careerResult = await getCareerInsightsService({ userId: user.id });

    if (careerResult.bestMatch) {
      console.log(`\n✅ BEST CURRENT ROLE MATCH: ${careerResult.bestMatch.role}`);
      console.log(`   Skills to learn for this role: ${careerResult.bestMatch.skillsToLearn.join(", ")}`);
    }

    if (careerResult.progression) {
      console.log(`\n✅ NEXT LOGICAL PROMOTION (Based on skills & difficulty):`);
      console.log(`   Target Role: ${careerResult.progression.role}`);
      console.log(`   You already know: ${careerResult.progression.overlappingSkills.length} skills`);
      console.log(`   You need to learn: ${careerResult.progression.skillsToLearn.join(", ")}`);
    } else {
       console.log(`\n⚠️ No direct upward progression found yet (Need to learn more core skills first).`);
    }

    if (careerResult.lateralSwitches && careerResult.lateralSwitches.length > 0) {
      console.log(`\n✅ PIVOT OPPORTUNITIES (Roles sharing 40%+ of your skills):`);
      careerResult.lateralSwitches.slice(0, 2).forEach(sw => {
        console.log(`   - ${sw.role} (Overlap: ${sw.overlapPercent}%)`);
        console.log(`     Learn: ${sw.skillsToLearn.join(", ")}`);
      });
    }

    console.log("\n=========================================");
    console.log("TEST COMPLETED SUCCESSFULLY.");
    process.exit(0);

  } catch (err) {
    console.error("Test failed:", err);
    process.exit(1);
  }
}

testMatching();
