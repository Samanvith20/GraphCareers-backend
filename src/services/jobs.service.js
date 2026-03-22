import { eq, sql } from "drizzle-orm";
import neo4j from "neo4j-driver";

import { getNeo4jSession } from "../db/neo4j/session.js";
import { normalizeSkill, SKILL_ALIASES, toNumber } from "../lib/utils.js";
import { db } from "../db/index.js";
import { jobMatches, users } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import {  getUserAccessFromUser } from "./userAccess.service.js";


// ─── Helpers ──────────────────────────────────────────────────────────────────

function cleanArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "object") return Object.values(val);
  return [];
}

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

function recordToJob(record) {
  const postedDate = new Date(record.get("postedAt"));
  const hoursAgo   = Math.floor((Date.now() - postedDate) / 3_600_000);
  const daysAgo    = Math.floor(hoursAgo / 24);

  return {
    id:            record.get("jobId"),
    title:         record.get("title"),
    company:       record.get("company")  || "Not specified",
    location:      record.get("location") || "Remote",
    workMode:      record.get("workMode"),
    jobType:       record.get("jobType"),
    url:           record.get("url"),
    role:          record.get("role"),
    level:         record.get("level"),
    source:        record.get("source"),
    minExp:        toNumber(record.get("minExp")),
    maxExp:        toNumber(record.get("maxExp")),
    matchPercent:  toNumber(record.get("matchPercent")),
    matchedCount:  toNumber(record.get("matchedCount")),
    totalRequired: toNumber(record.get("totalRequired")),
    qualityScore:  toNumber(record.get("qualityScore")),
    matchedSkills: record.get("matchedSkills"),
    missingSkills: record.get("missingSkills"),
    postedAt:      postedDate.toISOString(),
    hoursAgo,
    daysAgo,
    isNew:         hoursAgo < 24,
    timeText:
      hoursAgo < 1    ? "Just posted"
      : hoursAgo < 24 ? `${hoursAgo}h ago`
      : daysAgo === 1 ? "Yesterday"
      : `${daysAgo}d ago`,
  };
}

function diversifyTopK(jobs, k) {
  const seen = new Set();
  const top  = [];
  for (const job of jobs) {
    if (!seen.has(job.company)) {
      top.push(job);
      seen.add(job.company);
    }
    if (top.length === k) break;
  }
  return top;
}

const CHUNK_SIZE = 25;

// ─── Main service ─────────────────────────────────────────────────────────────

export async function getMatchedJobsService({
  userId,
  workMode = null,
  jobType  = null,
}) {
  if (!userId) throw new AppError("User ID is required", 400);

  // ── 1. User fetch ─────────────────────────────────────────────────────────
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


const access = getUserAccessFromUser(user);
const queryLimit = Math.min(access.jobLimit, 200);
console.log("queylimit",queryLimit)
console.log("user pala",access.plan)

  // ── 2. Experience — exact, no padding ────────────────────────────────────
  // user.experience stored in months
  // 0 months → match only 0-exp jobs
  // 24 months (2 yrs) → match jobs requiring ≤ 2 yrs exactly
  const experienceYears = (user.experience || 0) / 12;
  const maxExpForQuery  = Math.floor(experienceYears); // strict floor, no +1 buffer

  const skillVariants = expandSkills(user.skills);

  // ── 3. Neo4j — plan limit enforced here, not in frontend ─────────────────
  const session = getNeo4jSession();
  let jobs;

  try {
    const result = await session.run(
      `
      MATCH (j:Job)
      WHERE j.posted_at  > datetime() - duration({days: 3})
        AND j.expires_at > datetime()
        AND ($workMode IS NULL OR j.work_mode = $workMode)
        AND ($jobType  IS NULL OR j.job_type  = $jobType)
        AND (
          j.min_experience IS NULL
          OR j.min_experience <= $maxExpForQuery
        )

      WITH j
      MATCH (j)-[:REQUIRES]->(req:Skill)
      WITH j, collect(DISTINCT req.canonical) AS jobSkills
      WHERE size(jobSkills) >= 1
        AND size(jobSkills) <= 20

      WITH j, jobSkills,
           [s IN jobSkills WHERE s IN $skillVariants] AS matchedSkills
      WHERE size(matchedSkills) >= 3

      WITH j, jobSkills, matchedSkills,
           size(jobSkills)     AS totalRequired,
           size(matchedSkills) AS matchedCount,
           round(100.0 * size(matchedSkills) / size(jobSkills), 1) AS matchPercent,
           [s IN jobSkills WHERE NOT s IN $skillVariants][0..5]    AS missingSkills,
           duration.between(datetime(j.posted_at), datetime()).hours AS hoursOld
      WHERE matchPercent >= 50

      WITH j, matchedSkills, missingSkills, matchedCount, totalRequired, matchPercent, hoursOld,
           (matchPercent * 1.5)
           + (matchedCount * 5)
           - (size(missingSkills) * 2)
           - (hoursOld / 24.0 * 1.5)
           AS qualityScore

      OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
      OPTIONAL MATCH (j)-[:MAPS_TO]->(r:Role)

      RETURN j.job_id           AS jobId,
             j.title            AS title,
             j.source_url       AS url,
             c.name             AS company,
             j.location         AS location,
             j.work_mode        AS workMode,
             j.job_type         AS jobType,
             j.source           AS source,
             j.min_experience   AS minExp,
             j.max_experience   AS maxExp,
             j.posted_at        AS postedAt,
             r.role_title       AS role,
             r.difficulty_level AS level,
             matchedSkills,
             missingSkills,
             matchedCount,
             totalRequired,
             matchPercent,
             qualityScore

      ORDER BY qualityScore DESC, matchPercent DESC, hoursOld ASC
      LIMIT $queryLimit
      `,
      {
        skillVariants,
        workMode,
        jobType,
        maxExpForQuery: neo4j.int(maxExpForQuery),
        queryLimit:     neo4j.int(queryLimit),
      },
    );

    jobs = result.records.map(recordToJob);
  } finally {
    session.close().catch(() => {});
  }

  // ── 4. Background RAG store (non-blocking) ────────────────────────────────
  const topJobs = diversifyTopK(jobs, 15);

  setImmediate(async () => {
    try {
      await db.transaction(async (tx) => {
        await tx.delete(jobMatches).where(eq(jobMatches.userId, userId));
        if (!topJobs.length) return;

        const rows = topJobs.map((job) => ({
          userId,
          jobSourceId:   String(job.id),
          matchedCount:  Number(job.matchedCount)  || 0,
          requiredCount: Number(job.totalRequired) || 0,
          matchPercent:  Number(job.matchPercent)  || 0,
          score:         Number(job.qualityScore)  || 0,
          matchedSkills: cleanArray(job.matchedSkills).map(String),
          missingSkills: cleanArray(job.missingSkills).map(String),
        }));

        for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
          await tx
            .insert(jobMatches)
            .values(rows.slice(i, i + CHUNK_SIZE))
            .onConflictDoUpdate({
              target: [jobMatches.userId, jobMatches.jobSourceId],
              set: {
                matchedCount:  sql`excluded.matched_count`,
                requiredCount: sql`excluded.required_count`,
                matchPercent:  sql`excluded.match_percent`,
                score:         sql`excluded.score`,
                matchedSkills: sql`excluded.matched_skills`,
                missingSkills: sql`excluded.missing_skills`,
                matchedAt:     sql`now()`,
              },
            });
        }
        console.log(`✅ Stored ${topJobs.length} job matches for user ${userId}`);
      });
    } catch (err) {
      console.error("⚠️  Background RAG store failed:", err);
    }
  });

  return {
    jobs,
      isPro: access.plan === "pro",
    filters: {
      total:          jobs.length,
      avgMatch:       jobs.length > 0
        ? Math.round(jobs.reduce((s, j) => s + j.matchPercent, 0) / jobs.length)
        : 0,
      newJobs:        jobs.filter((j) => j.isNew).length,
      perfectMatches: jobs.filter((j) => j.matchPercent >= 90).length,
      userExperience: `${experienceYears.toFixed(1)} years`,
      appliedFilters: {
        workMode:      workMode || "All",
        jobType:       jobType  || "All",
        maxExperience: maxExpForQuery,
      },
    },
  };
}