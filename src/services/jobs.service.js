
import { eq } from "drizzle-orm";
import neo4j from "neo4j-driver";

import { getNeo4jSession } from "../db/neo4j/session.js";
import { getTargetLevels, normalizeSkill, toNumber } from "../lib/utils.js";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";

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

  if (!user?.skills?.length) {
    return {
      jobs: [],
      message: "Add your skills to see matching jobs",
    };
  }

  const userSkills = user.skills
    .map(normalizeSkill)
    .filter(Boolean);

  const session = getNeo4jSession();

  try {
    //console.log("userSkills:", userSkills);
    const result = await session.run(
      
        
        `
        MATCH (j:Job)-[:REQUIRES]->(req:Skill)
WITH j, collect(DISTINCT req.canonical) AS jobSkills

// 1️⃣ Find intersection with user skills
WITH j,
     jobSkills,
     [s IN jobSkills WHERE s IN $userSkills] AS matchedSkills

// 2️⃣ Minimum matched skills gate (QUALITY CONTROL)
WHERE size(matchedSkills) >= 3


// 3️⃣ Compute metrics
WITH j,
     jobSkills,
     matchedSkills,
     size(jobSkills) AS totalRequired,
     size(matchedSkills) AS matchedCount,
     round(100.0 * size(matchedSkills) / size(jobSkills), 1) AS matchPercent,
     [s IN jobSkills WHERE NOT s IN $userSkills][0..5] AS missingSkills

WHERE matchPercent >= 80

// 5️⃣ Optional freshness (add later if needed)
 //AND datetime(j.posted_at) > datetime() - duration({days: 3})

// 6️⃣ Rank by quality, not just percent
WITH j, matchedSkills, missingSkills, matchedCount, totalRequired, matchPercent,
     (matchPercent * 1.3 + matchedCount * 5) AS qualityScore

OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
OPTIONAL MATCH (j)-[:MAPS_TO]->(r:Role)

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
       matchPercent

ORDER BY qualityScore DESC, matchPercent DESC
LIMIT 50
        `
        ,
      {
        userSkills,
        workMode,
        jobType,
        maxExperience: maxExperience
          ? neo4j.int(maxExperience)
          : null,
      }
    );

    // console.log("records:", result.records.length);
    const jobs = result.records.map((record) => {
      const postedDate = new Date(record.get("postedAt"));

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
      };
    });

    return {
      jobs,
      filters: {
        avgMatch:
          jobs.length > 0
            ? Math.round(
                jobs.reduce((s, j) => s + j.matchPercent, 0) /
                  jobs.length
              )
            : 0,
        exp: userExperience,
      },
    };
  } finally {
    await session.close();
  }
}



