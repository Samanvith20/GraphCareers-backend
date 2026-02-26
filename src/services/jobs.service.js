import { eq } from "drizzle-orm";
import neo4j from "neo4j-driver";

import { getNeo4jSession } from "../db/neo4j/session.js";
import { normalizeSkill, toNumber } from "../lib/utils.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

// lib/skillAliases.js
export const SKILL_ALIASES = {
  reactjs: ["react.js", "reactjs", "react"],
  nodejs: ["node.js", "nodejs", "node"],
  dotnet: [".net", "dotnet", "asp.net"],
  expressjs: ["express.js", "express"],
};

export async function getMatchedJobsService({
  userId,
  workMode = null,
  jobType = null,
  maxExperience = null,
}) {
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  const userExperience = user?.experience || 0;
  const experienceYears = userExperience / 12;

  if (!user?.skills?.length) {
    return {
      jobs: [],
      message: "Add your skills to see matching jobs",
    };
  }

  const userSkills = user.skills.map(normalizeSkill).filter(Boolean);
  const expandedUserSkills = new Set();

  for (const skill of userSkills) {
    expandedUserSkills.add(skill);

    Object.entries(SKILL_ALIASES).forEach(([canonical, aliases]) => {
      if (canonical === skill) {
        aliases.forEach((a) => expandedUserSkills.add(a));
      }
    });
  }

  const skillVariants = Array.from(expandedUserSkills);

  // Auto-set max experience if not provided
  const autoMaxExp =
    maxExperience ?? Math.max(1, Math.floor(experienceYears + 1.5));

  const session = getNeo4jSession();

  try {
    const result = await session.run(
      `
      // 1️⃣ Get all job skills
      MATCH (j:Job)-[:REQUIRES]->(req:Skill)
      WHERE datetime(j.posted_at) > datetime() - duration({days: 3})
        AND j.expires_at > datetime()
        // Apply filters early for performance
        AND ($workMode IS NULL OR j.work_mode = $workMode)
        AND ($jobType IS NULL OR j.job_type = $jobType)
        AND ($maxExperience IS NULL OR j.min_experience IS NULL OR j.min_experience <= $maxExperience)
      
      WITH j, collect(DISTINCT req.canonical) AS jobSkills
      
      // 2️⃣ Find intersection with user skills
      WITH j, jobSkills,
          [s IN jobSkills WHERE s IN $skillVariants] AS matchedSkills
      
      // 3️⃣ Quality gate: minimum 3 matched skills
      WHERE size(matchedSkills) >= 3
        AND size(jobSkills) <= 20  // Skip jobs with too many requirements
      
      // 4️⃣ Compute match metrics
      WITH j, jobSkills, matchedSkills,
           size(jobSkills) AS totalRequired,
           size(matchedSkills) AS matchedCount,
           round(100.0 * size(matchedSkills) / size(jobSkills), 1) AS matchPercent,
         [s IN jobSkills WHERE NOT s IN $skillVariants][0..5] AS missingSkills,
           duration.between(datetime(j.posted_at), datetime()).hours AS hoursOld
      
      // 5️⃣ Filter by match percentage
      WHERE matchPercent >= 50  // Lowered from 70 for more results
      
      // 6️⃣ Calculate quality score
      WITH j, matchedSkills, missingSkills, matchedCount, totalRequired, matchPercent, hoursOld,
           (matchPercent * 1.5) +           // Match is most important
           (matchedCount * 5) -             // Reward absolute matches
           (size(missingSkills) * 2) -      // Penalize skill gaps
           (hoursOld / 24.0 * 3) AS qualityScore  // Prefer recent jobs
      
      // 7️⃣ Get related data
      OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
      OPTIONAL MATCH (j)-[:MAPS_TO]->(r:Role)
      
      // 8️⃣ Return results
      RETURN j.job_id AS jobId,
             j.title AS title,
             j.source_url AS url,
             c.name AS company,
             j.location AS location,
             j.work_mode AS workMode,
             j.job_type AS jobType,
             j.source AS source,
             j.min_experience AS minExp,
             j.max_experience AS maxExp,
             j.posted_at AS postedAt,
             r.role_title AS role,
             r.difficulty_level AS level,
             matchedSkills,
             missingSkills,
             matchedCount,
             totalRequired,
             matchPercent,
             qualityScore
      
      ORDER BY qualityScore DESC, matchPercent DESC
      LIMIT 50
      `,
      {
        userSkills,
        skillVariants,
        workMode,
        jobType,
        maxExperience: neo4j.int(autoMaxExp),
      },
    );

    const jobs = result.records.map((record) => {
      const postedAt = record.get("postedAt");
      const postedDate = new Date(postedAt);
      const now = new Date();
      const hoursAgo = Math.floor((now - postedDate) / (1000 * 60 * 60));
      const daysAgo = Math.floor(hoursAgo / 24);

      return {
        id: record.get("jobId"),
        title: record.get("title"),
        company: record.get("company") || "Not specified",
        location: record.get("location") || "Remote",
        workMode: record.get("workMode"),
        jobType: record.get("jobType"),
        url: record.get("url"),
        role: record.get("role"),
        level: record.get("level"),
        source: record.get("source"),

        minExp: toNumber(record.get("minExp")),
        maxExp: toNumber(record.get("maxExp")),

        matchPercent: toNumber(record.get("matchPercent")),
        matchedCount: toNumber(record.get("matchedCount")),
        totalRequired: toNumber(record.get("totalRequired")),
        matchedSkills: record.get("matchedSkills"),
        missingSkills: record.get("missingSkills"),

        postedAt: postedDate.toISOString(),
        hoursAgo,
        daysAgo,
        isNew: hoursAgo < 24,
        timeText:
          hoursAgo < 1
            ? "Just posted"
            : hoursAgo < 24
              ? `${hoursAgo}h ago`
              : daysAgo === 1
                ? "Yesterday"
                : `${daysAgo}d ago`,
      };
    });

    return {
      jobs,
      filters: {
        total: jobs.length,
        avgMatch:
          jobs.length > 0
            ? Math.round(
                jobs.reduce((s, j) => s + j.matchPercent, 0) / jobs.length,
              )
            : 0,
        newJobs: jobs.filter((j) => j.isNew).length,
        perfectMatches: jobs.filter((j) => j.matchPercent >= 90).length,
        userExperience: `${experienceYears.toFixed(1)} years`,
        appliedFilters: {
          workMode: workMode || "All",
          jobType: jobType || "All",
          maxExperience: autoMaxExp,
        },
      },
    };
  } finally {
    await session.close();
  }
}
