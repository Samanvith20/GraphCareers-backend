import { eq, sql } from "drizzle-orm";
import neo4j from "neo4j-driver";

import { getNeo4jSession } from "../db/neo4j/session.js";
import { normalizeSkill, SKILL_ALIASES, toNumber } from "../lib/utils.js";
import { db } from "../db/index.js";
import { jobMatches, users,jobs as jobsTable } from "../db/schema.js";
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
  },
});
if (!user) throw new AppError("User not found", 404);
if (!user.skills?.length) throw new AppError("User has no skills", 400);


const queryLimit = 200; // or even higher if needed

  // ── Experience window ─────────────────────────────────────────────────────
const expMonths = user.experience || 0;
const expYears  = expMonths / 12;
//console.log("experinece",expYears,expMonths)

let minExp, maxExp;

if (expMonths === 0) {
  // Fresher — entry level only
  minExp = 0;
  maxExp = 0;

} else if (expYears <= 0.5) {
  // Up to 6 months
  minExp = 0;
  maxExp = 1;

} else if (expYears <= 1) {
  // 6–12 months
  minExp = 0;
  maxExp = 1;

} else if (expYears <= 2) {
  // 1–2 years — your 1.5yr user lands here → only 0-2yr jobs
  minExp = 0;
  maxExp = 2;

} else if (expYears <= 3) {
  // 2–3 years — allow slight stretch to 3yr max
  minExp = 1;
  maxExp = 3;

} else if (expYears <= 5) {
  // 3–5 years
  minExp = Math.floor(expYears) - 1;
  maxExp = Math.ceil(expYears) + 1;

} else if (expYears <= 8) {
  // 5–8 years
  minExp = Math.floor(expYears) - 1;
  maxExp = Math.ceil(expYears) + 2;

} else {
  // 8+ years senior
  minExp = Math.floor(expYears) - 2;
  maxExp = Math.ceil(expYears) + 2;
}

const skillVariants = expandSkills(user.skills);

const session = getNeo4jSession();
let jobs;

try {
  const result = await session.run(
`
MATCH (j:Job)
WHERE j.posted_at > datetime() - duration({days: 3})
  AND j.expires_at > datetime()
  AND (
    (j.min_experience IS NULL AND j.max_experience IS NULL)
    OR
    (
      (j.min_experience IS NULL OR j.min_experience <= $maxExp)
      AND
      (j.max_experience IS NULL OR j.max_experience >= $minExp)
    )
  )

MATCH (j)-[:REQUIRES]->(s:Skill)

WITH j,
     collect(DISTINCT s.canonical) AS jobSkills

WITH j,
     jobSkills,
     [sk IN jobSkills WHERE sk IN $skillVariants]             AS matchedSkills,
     [sk IN jobSkills WHERE NOT sk IN $skillVariants][0..5]   AS missingSkills

WHERE size(matchedSkills) >= 3
  AND size(matchedSkills) * 100.0 / size(jobSkills) >= 40

WITH j,
     jobSkills,
     matchedSkills,
     missingSkills,
     size(jobSkills)     AS totalRequired,
     size(matchedSkills) AS matchedCount,
     round(100.0 * size(matchedSkills) / size(jobSkills), 1) AS matchPercent,
     coalesce(j.hours_old, 0)                                AS hoursOld

WITH j, matchedSkills, missingSkills, matchedCount, totalRequired, matchPercent, hoursOld,
     (matchPercent * 2.0)
     + (matchedCount * 6)
     - (size(missingSkills) * 2)
     - (hoursOld / 24.0 * 1.5)
     - abs(coalesce(j.min_experience, 0) - $minExp) * 2
     AS qualityScore

ORDER BY qualityScore DESC, matchPercent DESC

OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
OPTIONAL MATCH (j)-[:MAPS_TO]->(r:Role)

RETURN
  j.job_id           AS jobId,
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
  LIMIT $queryLimit
`,
    {
      skillVariants,
      workMode,
      jobType,
      minExp: neo4j.int(minExp),
      maxExp: neo4j.int(maxExp),
      queryLimit: neo4j.int(queryLimit),
    }
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
         // ✅ 1. Insert into jobs table (FIX)
         await tx.insert(jobsTable).values(
  topJobs
    .filter(job => job && job.id) // ✅ FIX
    .map((job) => ({
      sourceJobId: String(job.id),
      title: job.title,
      company: job.company,
      location: job.location,
      sourceUrl: job.url,
         salaryMin: job.salaryMin ?? null,
      salaryMax: job.salaryMax ?? null,
    }))
).onConflictDoNothing();

        const rows = topJobs.
        filter(job => job && job.id) // ✅ FIX
        .map((job) => ({
          
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
        //console.log(`✅ Stored ${topJobs.length} job matches for user ${userId}`);
      });
    } catch (err) {
      logger.error("Background job-match store failed", {
        userId,
        name:    err.name,
        message: err.message,
      });
    }
  });

  return {
    jobs,
      // isPro: access.plan === "pro",
    filters: {
      total:          jobs.length,
      avgMatch:       jobs.length > 0
        ? Math.round(jobs.reduce((s, j) => s + j.matchPercent, 0) / jobs.length)
        : 0,
      newJobs:        jobs.filter((j) => j.isNew).length,
      perfectMatches: jobs.filter((j) => j.matchPercent >= 90).length,
     userExperience: `${expYears.toFixed(1)} years`,
      appliedFilters: {
        workMode:      workMode || "All",
        jobType:       jobType  || "All",
        maxExperience: maxExp,
      },
    },
  };
}