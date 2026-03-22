import { eq } from "drizzle-orm";
import { neo4jDriver } from "../db/neo4j/driver.js";
import { users } from "../db/schema.js";
import { SKILL_ALIASES } from "../lib/utils.js";
import { db } from "../db/index.js";
import { AppError } from "../lib/AppError.js";
import { getUserAccessFromUser } from "./userAccess.service.js";
//import { isProUser } from "../lib/planUtils.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeSkill(skill) {
  return skill
    .toLowerCase()
    .replace(/[^a-z0-9.+#]/g, " ")
    .split(" ")
    .filter(Boolean);
}

function expandSkills(skills) {
  const normalized = skills.flatMap(normalizeSkill).filter(Boolean);
  const expanded   = new Set();
  for (const skill of normalized) {
    expanded.add(skill);
    for (const aliases of Object.values(SKILL_ALIASES)) {
      if (aliases.includes(skill)) aliases.forEach((a) => expanded.add(a));
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
    (s) => s.length > 1 && !NON_TECH_WORDS.has(s) && !/^\d+$/.test(s),
  );
}

function formatSalary(min, max) {
  if (!min || !max) return null;
  return `₹${Math.round(toSafeNumber(min) / 100000)}L - ₹${Math.round(toSafeNumber(max) / 100000)}L`;
}

function toSafeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && typeof value.toNumber === "function") return value.toNumber();
  return Number(value);
}

function jaccardOverlap(setA, setB) {
  const a            = new Set(setA);
  const b            = new Set(setB);
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union        = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─── Main service ─────────────────────────────────────────────────────────────

export async function getCareerInsightsService({ userId }) {
   const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      skills: true,
      experience: true,
      tier: true,
      credits: true,
      planExpiresAt: true,
    },
  });
  if (!user) throw new AppError("User not found", 404);
  if (!user.skills?.length) throw new AppError("User has no skills", 400);

  //const pro        = isProUser(user);   // ← single source of truth
  const access = getUserAccessFromUser(user);
  const pro = access.plan 
  console.log("pro:;",pro)
  const session    = neo4jDriver.session();
  const userSkills = expandSkills(user.skills);

  try {
    // ── Neo4j query (unchanged from your original) ────────────────────────
    const rolesResult = await session.run(
      `
      MATCH (r:Role)-[rel:REQUIRES]->(s:Skill)
      WHERE rel.frequency IS NOT NULL
        AND s.canonical IN $userSkills

      WITH r, collect(DISTINCT s.canonical) AS matchedSkills
      WHERE size(matchedSkills) >= 3

      MATCH (r)-[rel2:REQUIRES]->(s2:Skill)
      WHERE rel2.frequency IS NOT NULL

      OPTIONAL MATCH (j:Job)-[:MAPS_TO]->(r)
      WHERE j.expires_at > datetime()
      OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
      OPTIONAL MATCH (j)-[:OFFERS_SALARY]->(sal:Salary)

      WITH r,
           matchedSkills,
           collect(DISTINCT { name: s2.canonical, demandRank: s2.demand_rank }) AS allSkillsWithRank,
           collect(DISTINCT c.name)[0..10] AS companies,
           avg(sal.min) AS avgMin,
           avg(sal.max) AS avgMax

      RETURN r.role_title       AS role,
             r.difficulty_level AS difficulty,
             matchedSkills,
             allSkillsWithRank,
             companies,
             avgMin,
             avgMax
      `,
      { userSkills },
    );

    if (!rolesResult.records.length) {
      return { careerPath: [], progression: null, lateralSwitches: [], isPro: pro };
    }

    // ── Build enriched role objects ───────────────────────────────────────
    const roles = rolesResult.records
      .map((rec) => {
        const matched      = onlyTechnical(rec.get("matchedSkills") ?? []);
        const allWithRank  = rec.get("allSkillsWithRank") ?? [];
        const matchedSet   = new Set(matched);

        const missingWithRank = allWithRank
          .filter((x) => x?.name && !matchedSet.has(x.name) && onlyTechnical([x.name]).length > 0)
          .sort((a, b) => {
            const ra = toSafeNumber(a.demandRank) ?? 9999;
            const rb = toSafeNumber(b.demandRank) ?? 9999;
            return ra - rb;
          });

        const allSkillNames = onlyTechnical(allWithRank.map((x) => x?.name).filter(Boolean));
        if (matched.length < 2) return null;

        return {
          role:          rec.get("role"),
          difficulty:    toSafeNumber(rec.get("difficulty")) ?? 1,
          matchedSkills: matched,
          allSkills:     allSkillNames,
          missingSkills: missingWithRank.map((x) => x.name),
          companies:     rec.get("companies") ?? [],
          avgMin:        toSafeNumber(rec.get("avgMin")),
          avgMax:        toSafeNumber(rec.get("avgMax")),
          matchScore:    matched.length / Math.max(allSkillNames.length, 1),
        };
      })
      .filter(Boolean);

    if (!roles.length) {
      return { careerPath: [], progression: null, lateralSwitches: [], isPro: pro };
    }

    // ── Best current role ─────────────────────────────────────────────────
    const sorted   = [...roles].sort((a, b) => b.matchScore - a.matchScore);
    const bestRole = sorted[0];

    // ── Next-level progression ────────────────────────────────────────────
    const SENIORITY_LADDER = ["junior", "associate", "mid", "senior", "lead", "principal", "staff", "architect", "head", "director"];
    const getSeniorityIndex = (title) => {
      const lower = title.toLowerCase();
      for (let i = SENIORITY_LADDER.length - 1; i >= 0; i--) {
        if (lower.includes(SENIORITY_LADDER[i])) return i;
      }
      return -1;
    };

    const bestTokens    = new Set(bestRole.role.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter((t) => t.length > 3));
    const bestSeniority = getSeniorityIndex(bestRole.role);

    const nextRole = roles
      .filter((r) => {
        if (r.role === bestRole.role) return false;
        const titleTokens         = r.role.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ");
        const sharesFamilyToken   = titleTokens.some((t) => t.length > 3 && bestTokens.has(t));
        const isHarder            = (toSafeNumber(r.difficulty) ?? 1) > (toSafeNumber(bestRole.difficulty) ?? 1);
        const isHigherSeniority   = getSeniorityIndex(r.role) > bestSeniority;
        const gapRatio            = r.missingSkills.length / Math.max(r.allSkills.length, 1);
        return (isHarder || isHigherSeniority) && sharesFamilyToken && gapRatio <= 0.6;
      })
      .sort((a, b) => {
        const bestDiff = toSafeNumber(bestRole.difficulty) ?? 1;
        const aDelta   = Math.abs((toSafeNumber(a.difficulty) ?? 1) - bestDiff);
        const bDelta   = Math.abs((toSafeNumber(b.difficulty) ?? 1) - bestDiff);
        return aDelta !== bDelta ? aDelta - bDelta : b.matchScore - a.matchScore;
      })[0] ?? null;

    // ── Lateral switches ──────────────────────────────────────────────────
    const lateralSwitches = roles
      .filter((r) => {
        if (r.role === bestRole.role)           return false;
        if (nextRole && r.role === nextRole.role) return false;
        const overlap = jaccardOverlap(bestRole.allSkills, r.allSkills);
        r._overlap = overlap;
        return overlap >= 0.35;
      })
      .sort((a, b) => b._overlap - a._overlap)
      .slice(0, 3)
      .map((r) => ({
        role:              r.role,
        overlapPercent:    Math.round(r._overlap * 100),
        overlappingSkills: r.matchedSkills,
        skillsToLearn:     r.missingSkills.slice(0, 6),
        companies:         r.companies,
        salary:            formatSalary(r.avgMin, r.avgMax),
      }));

    // ── careerPath top 4 ─────────────────────────────────────────────────
    const topRoles = sorted.slice(0, 4);

    // ─────────────────────────────────────────────────────────────────────
    // Return — gating happens HERE, not in the frontend
    //
    // Free:  careerPath (roles + matched skills + companies[0..3])
    //        NO salary, NO missingSkills, NO progression, NO lateralSwitches
    //
    // Pro:   everything
    // ─────────────────────────────────────────────────────────────────────
    return {
      isPro,

      careerPath: topRoles.map((r, i) => ({
        rank:          i + 1,
        role:          r.role,
        matchedSkills: r.matchedSkills,
        // Free users get empty missingSkills — frontend shows lock UI
        missingSkills: pro ? r.missingSkills.slice(0, 8) : [],
        // Free users get first 3 companies only
        companies:     pro ? r.companies : r.companies.slice(0, 3),
        // Free users get null salary
        salary:        pro ? formatSalary(r.avgMin, r.avgMax) : null,
      })),

      bestMatch: {
        role:          bestRole.role,
        matchScore:    Math.round(bestRole.matchScore * 100),
        matchedSkills: bestRole.matchedSkills,
        skillsToLearn: pro ? bestRole.missingSkills.slice(0, 8) : [],
        companies:     pro ? bestRole.companies : bestRole.companies.slice(0, 3),
        salary:        pro ? formatSalary(bestRole.avgMin, bestRole.avgMax) : null,
      },

      // Progression and lateralSwitches: null/[] for free — frontend renders ProNudge instead
      progression:     pro ? (nextRole ? {
        role:              nextRole.role,
        difficulty:        nextRole.difficulty,
        skillsToLearn:     nextRole.missingSkills.slice(0, 8),
        overlappingSkills: nextRole.matchedSkills,
        companies:         nextRole.companies,
        salary:            formatSalary(nextRole.avgMin, nextRole.avgMax),
      } : null) : null,

      lateralSwitches: pro ? lateralSwitches : [],
    };

  } finally {
    await session.close();
  }
}