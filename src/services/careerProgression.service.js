import { neo4jDriver } from "../db/neo4j/driver.js";


export async function getCareerInsightsService({ skills }) {
  const session = neo4jDriver.session();
 const userSkills = skills
  .flatMap(normalizeSkill)
  .filter(Boolean);
  function normalizeSkill(skill) {
  return skill
    .toLowerCase()
    .replace(/[^a-z0-9.+#]/g, " ")
    .split(" ")
    .filter(Boolean);
}
 
  function formatSalary(min, max) {
  if (!min || !max) return null;
  return `₹${Math.round(min / 100000)}L - ₹${Math.round(max / 100000)}L`;
}
const NON_TECH_WORDS = new Set([
  "user","users","experience","management","inventory",
  "front","end","design","system","systems",
  "job","processing","rate","limiting","core","cloud"
]);

function onlyTechnical(skills) {
  return skills.filter(
    s =>
      s.length > 1 &&
      !NON_TECH_WORDS.has(s) &&
      !/^\d+$/.test(s)
  );
}

// --------------------------------------------------
// STEP A: Find which user skills are ACTUALLY USED
// --------------------------------------------------
// const usedSkillsResult = await session.run(
//   `
//   MATCH (r:Role)-[rel:REQUIRES]->(:Skill)-[:HAS_ATOMIC]->(a:AtomicSkill)
//   WHERE rel.frequency IS NOT NULL
//     AND a.name IN $userSkills
//   RETURN DISTINCT a.name AS skill
//   `,
//   { userSkills }
// );

// const usedSkills = usedSkillsResult.records.map(
//   r => r.get("skill")
// );

 


  try {
    // --------------------------------------------------
    // STEP 1: Fetch only roles that match AT LEAST 1 skill
    // --------------------------------------------------
    
    const result = await session.run(
       
      `
      MATCH (r:Role)-[rel:REQUIRES]->(s:Skill)-[:HAS_ATOMIC]->(a:AtomicSkill)
     WHERE rel.frequency IS NOT NULL
     AND a.name IN $userSkills

    WITH r, collect(DISTINCT a.name) AS matchedSkills
    WHERE size(matchedSkills) >= 3

MATCH (r)-[rel2:REQUIRES]->(:Skill)-[:HAS_ATOMIC]->(a2:AtomicSkill)
WHERE rel2.frequency IS NOT NULL

OPTIONAL MATCH (j:Job)-[:MAPS_TO]->(r)
WHERE j.expires_at > datetime()

OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
OPTIONAL MATCH (j)-[:OFFERS_SALARY]->(sal:Salary)

WITH r,
     matchedSkills,
     collect(DISTINCT a2.name) AS allSkills,
     collect(DISTINCT c.name)[0..10] AS companies,
     avg(sal.min) AS avgMin,
     avg(sal.max) AS avgMax

RETURN r.role_title AS role,
       matchedSkills,
       allSkills,
       companies,
       avgMin,
       avgMax;
      `,
  { userSkills }
);

    if (!result.records.length) {
      return { careerPath: [] };
    }
//     const unusedSkills = userSkills.filter(
//   s => !usedSkills.includes(s)
// );


    // --------------------------------------------------
    // STEP 2: Score roles (BLOCK ZERO MATCH)
    // --------------------------------------------------
   const scoredRoles = result.records
  .map((rec) => {
    const matched = onlyTechnical(rec.get("matchedSkills"));
    const all = onlyTechnical(rec.get("allSkills"));

    if (matched.length < 2) return null;

    return {
      role: rec.get("role"),
      matchedSkills: matched,
      missingSkills: all.filter(s => !matched.includes(s)),
      companies: rec.get("companies"),
      avgMin: rec.get("avgMin"),
      avgMax: rec.get("avgMax"),
    };
  })
  .filter(Boolean);

    if (!scoredRoles.length) {
      return { careerPath: [] };
    }

    // --------------------------------------------------
    // STEP 3: Sort & take TOP 3
    // --------------------------------------------------
    const topRoles = scoredRoles
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 3);

    // --------------------------------------------------
    // STEP 4: Perfect horizontal progression
    // --------------------------------------------------
  

    
    return {
  careerPath: topRoles.map((r, i) => ({
    rank: i + 1,
    role: r.role,
    matchedSkills: r.matchedSkills,
    missingSkills: r.missingSkills.slice(0, 8),
    companies: r.companies,
    salary: formatSalary(r.avgMin, r.avgMax),
  }))
};

  } finally {
    await session.close();
  }
}