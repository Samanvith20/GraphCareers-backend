
import { neo4jDriver } from "../db/neo4j/driver.js";
import { getTargetLevels, normalizeSkill, toNumber } from "../lib/utils.js";



/* ---------------- service ---------------- */

export async function getCareerInsightsService({
  skills,
  experienceMonths,
}) {
  const session = neo4jDriver.session();
  const userSkills = skills.map(normalizeSkill).filter(Boolean);
  const levels = getTargetLevels(experienceMonths);
  const experienceYears = (experienceMonths / 12).toFixed(1);

  try {
    /* =====================================================
       CURRENT BEST ROLE (where user fits now)
    ===================================================== */
    const currentResult = await session.run(
      `
      MATCH (r:Role)-[req:REQUIRES]->(s:Skill)
      WHERE s.canonical IN $skills
        AND (r.difficulty_level IN $currentLevels OR r.difficulty_level IS NULL)

      WITH r, collect({ skill: s.canonical, freq: req.frequency }) AS skillsWithFreq
      UNWIND skillsWithFreq AS sf
      WITH r, sf
      ORDER BY sf.freq DESC

      WITH r, collect(sf.skill)[0..20] AS topSkills
      WHERE size(topSkills) >= 10

      WITH r,
           [s IN topSkills WHERE s IN $skills] AS matchedSkills,
           [s IN topSkills WHERE NOT s IN $skills] AS missingSkills
      WHERE size(matchedSkills) >= 5

      MATCH (j:Job)-[:MAPS_TO]->(r)
      WHERE datetime(j.posted_at) > datetime() - duration({ days: 30 })
        AND j.expires_at > datetime()

      OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)

      WITH r, matchedSkills, missingSkills,
           round(100.0 * size(matchedSkills) / size(topSkills), 1) AS matchPercent,
           count(DISTINCT j) AS totalJobs,
           collect(DISTINCT c.name) AS companies

      ORDER BY matchPercent DESC
      LIMIT 1

      RETURN r.role_title AS role,
             r.difficulty_level AS level,
             matchPercent,
             matchedSkills,
             missingSkills,
             totalJobs,
             [c IN companies WHERE c IS NOT NULL][0..10] AS companies
      `,
      {
        skills: userSkills,
        currentLevels: levels.current,
      }
    );

    if (!currentResult.records.length) {
      return {
        profile: {
          experience: `${experienceYears} years`,
          skillsCount: userSkills.length,
        },
        currentRole: null,
        nextRoles: [],
        alternativeRoles: [],
      };
    }

    const currentRole = currentResult.records[0];
    const currentRoleTitle = currentRole.get("role");

    /* =====================================================
       NEXT LEVEL (vertical growth)
    ===================================================== */
    const verticalResult = await session.run(
      `
      MATCH (r:Role { role_title: $role })-[:REQUIRES]->(s:Skill)
      WHERE r.difficulty_level IN $nextLevels

      WITH r, collect(DISTINCT s.canonical) AS allSkills
      WHERE size(allSkills) >= 10

      WITH r,
           [s IN allSkills WHERE s IN $skills] AS matchedSkills,
           [s IN allSkills WHERE NOT s IN $skills] AS missingSkills,
           round(100.0 * size([s IN allSkills WHERE s IN $skills]) / size(allSkills), 1) AS readiness

      MATCH (j:Job)-[:MAPS_TO]->(r)
      WHERE datetime(j.posted_at) > datetime() - duration({ days: 30 })
        AND j.expires_at > datetime()

      WITH r, matchedSkills, missingSkills, readiness, count(DISTINCT j) AS totalJobs
      ORDER BY readiness DESC
      LIMIT 3

      RETURN r.role_title AS role,
             r.difficulty_level AS level,
             readiness,
             missingSkills[0..10] AS skillsToLearn,
             totalJobs
      `,
      {
        role: currentRoleTitle,
        nextLevels: levels.next,
        skills: userSkills,
      }
    );

    /* =====================================================
       ALTERNATIVE ROLES (horizontal growth)
    ===================================================== */
    const horizontalResult = await session.run(
      `
      MATCH (r:Role)-[:REQUIRES]->(s:Skill)
      WHERE r.role_title <> $role
        AND s.canonical IN $skills

      WITH r, collect(DISTINCT s.canonical) AS matchedSkills
      WHERE size(matchedSkills) >= 5

      MATCH (r)-[:REQUIRES]->(all:Skill)
      WITH r, matchedSkills, collect(DISTINCT all.canonical) AS allSkills
      WHERE size(allSkills) >= 10

      WITH r,
           round(100.0 * size(matchedSkills) / size(allSkills), 1) AS readiness,
           [s IN allSkills WHERE NOT s IN $skills] AS missingSkills

      MATCH (j:Job)-[:MAPS_TO]->(r)
      WHERE datetime(j.posted_at) > datetime() - duration({ days: 30 })
        AND j.expires_at > datetime()

      WITH r, readiness, missingSkills, count(DISTINCT j) AS totalJobs
      ORDER BY readiness DESC, totalJobs DESC
      LIMIT 6

      RETURN r.role_title AS role,
             r.difficulty_level AS level,
             readiness,
             missingSkills[0..10] AS skillsToLearn,
             totalJobs
      `,
      {
        role: currentRoleTitle,
        skills: userSkills,
      }
    );

    /* ---------------- response ---------------- */

    return {
      profile: {
        experience: `${experienceYears} years`,
        skillsCount: userSkills.length,
      },

      currentRole: {
        role: currentRole.get("role"),
        level: currentRole.get("level"),
        matchPercent: toNumber(currentRole.get("matchPercent")),
        matchedSkills: currentRole.get("matchedSkills"),
        missingSkills: currentRole.get("missingSkills"),
        totalJobs: toNumber(currentRole.get("totalJobs")),
        companies: currentRole.get("companies"),
      },

      nextRoles: verticalResult.records.map((r) => ({
        role: r.get("role"),
        level: r.get("level"),
        readiness: toNumber(r.get("readiness")),
        skillsToLearn: r.get("skillsToLearn"),
        totalJobs: toNumber(r.get("totalJobs")),
      })),

      alternativeRoles: horizontalResult.records.map((r) => ({
        role: r.get("role"),
        level: r.get("level"),
        readiness: toNumber(r.get("readiness")),
        skillsToLearn: r.get("skillsToLearn"),
        totalJobs: toNumber(r.get("totalJobs")),
      })),
    };
  } finally {
    await session.close();
  }
}