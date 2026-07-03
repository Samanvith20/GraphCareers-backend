import { db } from "../db/index.js";
import { users, resumes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../db/neo4j/session.js";
import { computeTargetedTrends } from "../services/targetedTrend.service.js";
import { normalizeSkill, SKILL_ALIASES } from "../lib/utils.js";
import { generateText } from "ai";
import { openrouter } from "../lib/openai.js";
import { randomUUID } from "crypto";
import fs from "fs";

function expandSkills(rawSkills) {
  const expanded = new Set();
  for (const skill of rawSkills) {
    const normalized = normalizeSkill(skill);
    if (!normalized) continue;
    expanded.add(normalized);
    const aliases = SKILL_ALIASES[normalized];
    if (aliases) aliases.forEach((a) => expanded.add(a));
  }
  return Array.from(expanded);
}

async function testPlatformFlow() {
  const userId = "2ccab0cd-d724-4b89-adcb-f38d87451d7e";
  const targetPlatform = "naukri"; // The platform we are optimizing for
  const requestId = randomUUID();

  console.log(`\n=== STEP 1: Fetching User Profile ===`);
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  let [resume] = await db.select().from(resumes).where(eq(resumes.userId, userId));
  
  if (!user || !resume || !resume.structuredJson) {
    console.error("User or valid master resume not found.");
    process.exit(1);
  }

  // Calculate experience window (same as jobs.service.js)
  const expMonths = user.experience || 0;
  const expYears  = expMonths / 12;
  let minExp = 0, maxExp = 2; // simplified for test
  if (expYears > 2) { minExp = 1; maxExp = 3; }
  
  const skillVariants = expandSkills(user.skills);

  console.log(`\n=== STEP 2: Fetching Top 100 Matched Jobs on ${targetPlatform.toUpperCase()} ===`);
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
        platform: targetPlatform,
        skillVariants,
        minExp: neo4j.int(minExp),
        maxExp: neo4j.int(maxExp)
      }
    );
    jobSourceIds = result.records.map(r => r.get("jobId"));
  } finally {
    await session.close();
  }

  console.log(`Found ${jobSourceIds.length} top matching jobs strictly on ${targetPlatform}.`);
  if (jobSourceIds.length === 0) {
    console.log("Not enough jobs to generate meaningful platform trends.");
    process.exit(1);
  }

  console.log(`\n=== STEP 3: Aggregating Top Skills (Platform Trends) ===`);
  const trends = await computeTargetedTrends(jobSourceIds, requestId);
  console.log(`Top aggregated skills required to pass ATS on ${targetPlatform}:`);
  trends.topSkills.forEach(s => console.log(` - ${s.skill} (${s.pct}% of top jobs)`));

  console.log(`\n=== STEP 4: Running Platform-Wide AI Resume Optimization ===`);
  const topSkillsStr = trends.topSkills.slice(0, 15).map(s => `${s.skill}`).join(", ");
  const context = `TARGET PLATFORM: This resume is being tailored to pass ATS filters broadly on the ${targetPlatform.toUpperCase()} platform based on the top 100 most relevant active jobs for the user's profile.\nTRENDING SKILLS REQUIRED: ${topSkillsStr}`;
  
  const prompt = `
You are an expert resume optimization specialist.

══════════════════════════════════════════════════
ABSOLUTE RULES — NEVER VIOLATE
══════════════════════════════════════════════════
1. NEVER invent employers, job titles, companies, or dates.
2. NEVER add skills or technologies not in the original resume.
3. NEVER fabricate metrics, percentages, or achievements.
4. Keep all company names, job titles, start/end dates EXACTLY as given.
5. You MAY: improve bullet phrasing, reorder skills to highlight the trending skills, strengthen summary tone.
6. Return ONLY valid JSON — no markdown fences.

══════════════════════════════════════════════════
CONTEXT FOR THIS PLATFORM
══════════════════════════════════════════════════
${context}

══════════════════════════════════════════════════
CANDIDATE RESUME
══════════════════════════════════════════════════
${typeof resume.structuredJson === 'string' ? resume.structuredJson : JSON.stringify(resume.structuredJson)}

══════════════════════════════════════════════════
OUTPUT — RETURN EXACTLY THIS JSON STRUCTURE
══════════════════════════════════════════════════
{
  "summary": "2-4 sentences. Platform-appropriate professional summary highlighting the trending skills if applicable.",
  "experience": [
    {"company": "(unchanged)", "title": "(unchanged)", "startDate": "(unchanged)", "endDate": "(unchanged)", "bullets": ["Action verb + specific impact"]}
  ],
  "skills": {
    "Languages": [], "Frameworks": [], "Databases": [], "Tools & DevOps": [], "Other": []
  },
  "optimizationNotes": [
    "Specific change made and exact reason based on platform trends."
  ]
}
`;

  console.log("Calling OpenRouter Model...");
  const { text } = await generateText({
    model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
    prompt,
    temperature: 0.2,
    maxTokens: 4000,
  });

  const cleanText = text.replace(/^```json/m, '').replace(/^```/m, '').trim();
  fs.writeFileSync("platform_payload.json", cleanText);
  console.log("\n✅ Platform-Wide Optimization Complete!");
  console.log("Saved the optimized JSON to platform_payload.json.");
  
  // Extract and show the optimization notes
  const parsed = JSON.parse(cleanText);
  console.log("\nOptimization Notes from AI:");
  parsed.optimizationNotes.forEach(n => console.log(` - ${n}`));

  process.exit(0);
}

testPlatformFlow().catch(err => {
  console.error(err);
  process.exit(1);
});
