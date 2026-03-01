import { neo4jDriver } from "../db/neo4j/driver.js";
import { SKILL_ALIASES } from "../lib/utils.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSkill(skill) {
  return skill
    .toLowerCase()
    .replace(/[^a-z0-9.+#]/g, " ")
    .split(" ")
    .filter(Boolean);
}

function expandSkills(skills) {
  const normalized = skills.flatMap(normalizeSkill).filter(Boolean);
  const expanded = new Set();

  for (const skill of normalized) {
    expanded.add(skill);
    for (const aliases of Object.values(SKILL_ALIASES)) {
      if (aliases.includes(skill)) {
        aliases.forEach((a) => expanded.add(a));
      }
    }
  }

  return Array.from(expanded);
}

const NON_TECH_WORDS = new Set([
  "user", "users", "experience", "management", "inventory",
  "front", "end", "design", "system", "systems",
  "job", "processing", "rate", "limiting", "core", "cloud",
]);

function onlyTechnical(skills) {
  return skills.filter(
    (s) => s.length > 1 && !NON_TECH_WORDS.has(s) && !/^\d+$/.test(s)
  );
}

function formatSalary(min, max) {
  if (!min || !max) return null;
  return `₹${Math.round(toSafeNumber(min) / 100000)}L - ₹${Math.round(toSafeNumber(max) / 100000)}L`;
}

// Neo4j returns integers as its own Integer type (has .toNumber()).
// Floats come back as plain JS numbers. This handles both safely.
function toSafeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  // Neo4j Integer object
  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value);
}

// Overlap ratio: |A ∩ B| / |A ∪ B|  (Jaccard)
function jaccardOverlap(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Main Service
// ---------------------------------------------------------------------------

export async function getCareerInsightsService({ skills }) {
  const session = neo4jDriver.session();
  const userSkills = expandSkills(skills);

  try {
    // -------------------------------------------------------------------------
    // QUERY 1:
    // For each Role that shares ≥ 3 atomic skills with the user:
    //   - matched atomic skills (with demand_rank for sorting missing skills)
    //   - all required atomic skills
    //   - salary, companies, difficulty_level
    // -------------------------------------------------------------------------
    const rolesResult = await session.run(
      `
      MATCH (r:Role)-[rel:REQUIRES]->(s:Skill)-[:HAS_ATOMIC]->(a:AtomicSkill)
      WHERE rel.frequency IS NOT NULL
        AND a.name IN $userSkills

      WITH r, collect(DISTINCT a.name) AS matchedAtomics
      WHERE size(matchedAtomics) >= 3

      // Fetch ALL required atomic skills for this role
      MATCH (r)-[rel2:REQUIRES]->(s2:Skill)-[:HAS_ATOMIC]->(a2:AtomicSkill)
      WHERE rel2.frequency IS NOT NULL

      // Demand rank lives on the Skill node (set by post-processing)
      WITH r, matchedAtomics, a2,
           s2.demand_rank AS demandRank

      OPTIONAL MATCH (j:Job)-[:MAPS_TO]->(r)
      WHERE j.expires_at > datetime()

      OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
      OPTIONAL MATCH (j)-[:OFFERS_SALARY]->(sal:Salary)

      WITH r,
           matchedAtomics,
           collect(DISTINCT { name: a2.name, demandRank: demandRank }) AS allAtomicsWithRank,
           collect(DISTINCT c.name)[0..10]  AS companies,
           avg(sal.min) AS avgMin,
           avg(sal.max) AS avgMax

      RETURN r.role_title       AS role,
             r.difficulty_level AS difficulty,
             matchedAtomics,
             allAtomicsWithRank,
             companies,
             avgMin,
             avgMax
      `,
      { userSkills }
    );

    if (!rolesResult.records.length) {
      return { careerPath: [], progression: null, lateralSwitches: [] };
    }

    // -------------------------------------------------------------------------
    // Build enriched role objects
    // -------------------------------------------------------------------------
    const roles = rolesResult.records
      .map((rec) => {
        const matched = onlyTechnical(rec.get("matchedAtomics") ?? []);
        const allWithRank = rec.get("allAtomicsWithRank") ?? [];

        // Separate matched vs missing; sort missing by demand_rank ASC
        // (lower rank = more in-demand = learn first)
        const matchedSet = new Set(matched);

        const missingWithRank = allWithRank
          .filter((x) => x?.name && !matchedSet.has(x.name) && onlyTechnical([x.name]).length > 0)
          .sort((a, b) => {
            const ra = toSafeNumber(a.demandRank) ?? 9999;
            const rb = toSafeNumber(b.demandRank) ?? 9999;
            return ra - rb;
          });

        const allSkillNames = onlyTechnical(allWithRank.map((x) => x?.name).filter(Boolean));

        if (matched.length < 2) return null;

        // matchScore: weighted by matched count and penalised by gap size
        const matchScore =
          matched.length / Math.max(allSkillNames.length, 1);

        return {
          role: rec.get("role"),
          difficulty: toSafeNumber(rec.get("difficulty")) ?? 1,  // numeric 1-5 expected
          matchedSkills: matched,
          allSkills: allSkillNames,
          missingSkills: missingWithRank.map((x) => x.name),
          companies: rec.get("companies") ?? [],
          avgMin: toSafeNumber(rec.get("avgMin")),
          avgMax: toSafeNumber(rec.get("avgMax")),
          matchScore,                               // ← BUG FIX: was never set before
        };
      })
      .filter(Boolean);

    if (!roles.length) {
      return { careerPath: [], progression: null, lateralSwitches: [] };
    }

    // -------------------------------------------------------------------------
    // STEP A: Best current role  (highest matchScore)
    // -------------------------------------------------------------------------
    const sorted = [...roles].sort((a, b) => b.matchScore - a.matchScore);
    const bestRole = sorted[0];

    // -------------------------------------------------------------------------
    // STEP B: Next-level progression role
    // Strategy: same role family (title contains common token) OR next
    //   difficulty_level, with an acceptable skill gap (≤ 60 % missing).
    //   Tie-break: lowest gap + highest difficulty jump.
    // -------------------------------------------------------------------------

    // Extract a "family token" from bestRole title  e.g. "Backend Developer" → "backend"
    const bestTokens = new Set(
      bestRole.role
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(" ")
        .filter((t) => t.length > 3)
    );

    const progressionCandidates = roles
      .filter((r) => {
        if (r.role === bestRole.role) return false;

        // Must be higher difficulty OR have a clear seniority keyword
        const isHarder = (r.difficulty ?? 1) > (bestRole.difficulty ?? 1);
        const titleTokens = r.role.toLowerCase().split(" ");
        const sharesFamilyToken = titleTokens.some((t) => bestTokens.has(t));

        // Skill gap must be learnable (user already knows > 40 %)
        const gapRatio = r.missingSkills.length / Math.max(r.allSkills.length, 1);
        const learnableGap = gapRatio <= 0.6;

        return (isHarder || sharesFamilyToken) && learnableGap;
      })
      .sort((a, b) => {
        // prefer higher difficulty first, then higher matchScore
        const diffDelta = (b.difficulty ?? 1) - (a.difficulty ?? 1);
        if (diffDelta !== 0) return diffDelta;
        return b.matchScore - a.matchScore;
      });

    const nextRole = progressionCandidates[0] ?? null;

    // -------------------------------------------------------------------------
    // STEP C: Lateral switch roles
    // High Jaccard overlap with bestRole's skills but different role family,
    // ranked by overlap DESC.  Return top 3.
    // -------------------------------------------------------------------------
    const lateralSwitches = roles
      .filter((r) => {
        if (r.role === bestRole.role) return false;
        if (nextRole && r.role === nextRole.role) return false;

        const overlap = jaccardOverlap(bestRole.allSkills, r.allSkills);
        r._overlap = overlap;                       // stash for sort
        return overlap >= 0.35;                     // at least 25 % overlap
      })
      .sort((a, b) => b._overlap - a._overlap)
      .slice(0, 3)
      .map((r) => ({
        role: r.role,
        overlapPercent: Math.round(r._overlap * 100),
        overlappingSkills: r.matchedSkills,         // skills user already has that apply
        skillsToLearn: r.missingSkills.slice(0, 6), // top demand-ranked missing skills
        companies: r.companies,
        salary: formatSalary(r.avgMin, r.avgMax),
      }));

    // -------------------------------------------------------------------------
    // STEP D: careerPath  (top 4 by matchScore — keeps frontend shape intact)
    // -------------------------------------------------------------------------
    const topRoles = sorted.slice(0, 4);

    // -------------------------------------------------------------------------
    // Return  — shape is a SUPERSET of the old shape so frontend stays intact
    // -------------------------------------------------------------------------
    return {
      // ── Existing field (frontend uses this today) ─────────────────────────
      careerPath: topRoles.map((r, i) => ({
        rank: i + 1,
        role: r.role,
        matchedSkills: r.matchedSkills,
        missingSkills: r.missingSkills.slice(0, 8),
        companies: r.companies,
        salary: formatSalary(r.avgMin, r.avgMax),
      })),

      // ── NEW fields (safe to ignore on frontend until you're ready) ────────

      // Best role the user fits RIGHT NOW + priority skills to level up
      bestMatch: {
        role: bestRole.role,
        matchScore: Math.round(bestRole.matchScore * 100),   // e.g. 78 (%)
        matchedSkills: bestRole.matchedSkills,
        skillsToLearn: bestRole.missingSkills.slice(0, 8),   // sorted by market demand
        companies: bestRole.companies,
        salary: formatSalary(bestRole.avgMin, bestRole.avgMax),
      },

      // Next role in the same career ladder
      progression: nextRole
        ? {
            role: nextRole.role,
            difficulty: nextRole.difficulty,
            skillsToLearn: nextRole.missingSkills.slice(0, 8), // demand-ranked
            overlappingSkills: nextRole.matchedSkills,
            companies: nextRole.companies,
            salary: formatSalary(nextRole.avgMin, nextRole.avgMax),
          }
        : null,

      // Roles easy to switch into based on skill overlap
      lateralSwitches,
    };
  } finally {
    await session.close();
  }
}