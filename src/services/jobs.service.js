import { eq, sql } from "drizzle-orm";
import neo4j from "neo4j-driver";

import { getNeo4jSession } from "../db/neo4j/session.js";
import { normalizeSkill, SKILL_ALIASES, toNumber } from "../lib/utils.js";
import { db } from "../db/index.js";
import { jobMatches, users, jobs as jobsTable } from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { getUserAccessFromUser } from "./userAccess.service.js";


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
  page = 1,
  limit = 20,
  days = 3
}) {
  if (!userId) throw new AppError("User ID is required", 400);

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      skills: true,
      experience: true,
      planExpiresAt: true,
      tier: true,
      credits: true
    },
  });
  if (!user) throw new AppError("User not found", 404);
  if (!user.skills?.length) throw new AppError("User has no skills", 400);

  const access = getUserAccessFromUser(user);

  const expMonths = user.experience || 0;
  const expYears  = expMonths / 12;

  let minExp, maxExp;
  if (expMonths === 0) { minExp = 0; maxExp = 0; }
  else if (expYears <= 0.5) { minExp = 0; maxExp = 1; }
  else if (expYears <= 1) { minExp = 0; maxExp = 1; }
  else if (expYears <= 2) { minExp = 0; maxExp = 2; }
  else if (expYears <= 3) { minExp = 1; maxExp = 3; }
  else if (expYears <= 5) { minExp = Math.floor(expYears) - 1; maxExp = Math.ceil(expYears) + 1; }
  else if (expYears <= 8) { minExp = Math.floor(expYears) - 1; maxExp = Math.ceil(expYears) + 2; }
  else { minExp = Math.floor(expYears) - 2; maxExp = Math.ceil(expYears) + 2; }

  const skillVariants = expandSkills(user.skills);
  const skip = (page - 1) * limit;

  // 1. Calculate thresholds in JS for index utilization
  const fromDateObj = new Date();
  fromDateObj.setDate(fromDateObj.getDate() - days);
  const fromDate = fromDateObj.toISOString();

  const newJobsDateObj = new Date();
  newJobsDateObj.setHours(newJobsDateObj.getHours() - 24);
  const newJobsThreshold = newJobsDateObj.toISOString();

  const workModeFilter = (!workMode || workMode === "All") ? null : workMode;
  const jobTypeFilter = (!jobType || jobType === "All") ? null : jobType;

  const session = getNeo4jSession();
  let paginatedJobs = [];
  let filters = { total: 0, avgMatch: 0, newJobs: 0, perfectMatches: 0 };

  const cypherParams = {
    skillVariants,
    minExp: neo4j.int(minExp),
    maxExp: neo4j.int(maxExp),
    fromDate,
    newJobsThreshold,
    workModeFilter,
    jobTypeFilter,
    skip: neo4j.int(skip),
    limit: neo4j.int(limit)
  };

  let optionalWhere = "";
  if (workModeFilter) optionalWhere += " AND j.work_mode = $workModeFilter";
  if (jobTypeFilter) optionalWhere += " AND j.job_type = $jobTypeFilter";

  const statsQuery = `
    MATCH (j:Job)
    WHERE j.posted_at >= datetime($fromDate)
      AND j.expires_at > datetime()
      ${optionalWhere}
      AND (
        (j.min_experience IS NULL AND j.max_experience IS NULL)
        OR (
          (j.min_experience IS NULL OR j.min_experience <= ($maxExp + 1))
          AND
          (j.max_experience IS NULL OR j.max_experience >= ($minExp - 1))
        )
      )
    MATCH (j)-[:REQUIRES]->(s:Skill)
    WITH j, collect(DISTINCT s.canonical) AS jobSkills
    WITH j, jobSkills, size([sk IN jobSkills WHERE sk IN $skillVariants]) AS matchedCount
    WHERE matchedCount >= 1
      AND matchedCount * 100.0 / size(jobSkills) >= 20
    WITH j, matchedCount, round(100.0 * matchedCount / size(jobSkills), 1) AS matchPercent
    RETURN 
      count(j) AS totalJobs,
      coalesce(avg(matchPercent), 0) AS avgMatch,
      sum(CASE WHEN matchPercent >= 85 THEN 1 ELSE 0 END) AS perfectMatches,
      sum(CASE WHEN j.posted_at >= datetime($newJobsThreshold) THEN 1 ELSE 0 END) AS newJobs
  `;

  const jobsQuery = `
    MATCH (j:Job)
    WHERE j.posted_at >= datetime($fromDate)
      AND j.expires_at > datetime()
      ${optionalWhere}
      AND (
        (j.min_experience IS NULL AND j.max_experience IS NULL)
        OR (
          (j.min_experience IS NULL OR j.min_experience <= ($maxExp + 1))
          AND
          (j.max_experience IS NULL OR j.max_experience >= ($minExp - 1))
        )
      )
    MATCH (j)-[:REQUIRES]->(s:Skill)
    WITH j, collect(DISTINCT s.canonical) AS jobSkills
    WITH j, jobSkills,
         [sk IN jobSkills WHERE sk IN $skillVariants] AS matchedSkills,
         [sk IN jobSkills WHERE NOT sk IN $skillVariants][0..5] AS missingSkills
    WHERE size(matchedSkills) >= 1
      AND size(matchedSkills) * 100.0 / size(jobSkills) >= 20
    WITH j, jobSkills, matchedSkills, missingSkills,
         size(jobSkills) AS totalRequired,
         size(matchedSkills) AS matchedCount,
         round(100.0 * size(matchedSkills) / size(jobSkills), 1) AS matchPercent,
         coalesce(j.hours_old, 0) AS hoursOld
    WITH j, matchedSkills, missingSkills, matchedCount, totalRequired, matchPercent,
         (matchPercent * 2.0) + (matchedCount * 6) - (size(missingSkills) * 2) - (hoursOld / 24.0 * 1.5) - abs(coalesce(j.min_experience, 0) - $minExp) * 2 AS qualityScore
    ORDER BY qualityScore DESC, matchPercent DESC
    SKIP $skip
    LIMIT $limit
    OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
    OPTIONAL MATCH (j)-[:MAPS_TO]->(r:Role)
    RETURN
      j.job_id AS jobId, j.title AS title, j.source_url AS url,
      c.name AS company, j.location AS location, j.work_mode AS workMode,
      j.job_type AS jobType, j.source AS source, j.min_experience AS minExp,
      j.max_experience AS maxExp, j.posted_at AS postedAt,
      j.salary_min AS salaryMin, j.salary_max AS salaryMax,
      r.role_title AS role, r.difficulty_level AS level,
      matchedSkills, missingSkills,
      matchedCount, totalRequired,
      matchPercent, qualityScore
  `;

  try {
    const statsRes = await session.run(statsQuery, cypherParams);
    const jobsRes = await session.run(jobsQuery, cypherParams);

    if (statsRes.records.length > 0) {
      const row = statsRes.records[0];
      filters.total = toNumber(row.get("totalJobs"));
      filters.avgMatch = Math.round(toNumber(row.get("avgMatch")));
      filters.perfectMatches = toNumber(row.get("perfectMatches"));
      filters.newJobs = toNumber(row.get("newJobs"));
    }

    paginatedJobs = jobsRes.records.map(record => {
      const postedDate = new Date(record.get("postedAt"));
      const hoursAgo   = Math.floor((Date.now() - postedDate) / 3600000);
      const daysAgo    = Math.floor(hoursAgo / 24);

      return {
        id:            record.get("jobId"),
        title:         record.get("title"),
        company:       record.get("company")  || "Not specified",
        location:      record.get("location") || "Remote",
        url:           record.get("url"),
        matchPercent:  toNumber(record.get("matchPercent")),
        matchedSkills: record.get("matchedSkills"),
        missingSkills: record.get("missingSkills"),
        matchedCount:  toNumber(record.get("matchedCount")),
        totalRequired: toNumber(record.get("totalRequired")),
        minExp:        toNumber(record.get("minExp")),
        maxExp:        toNumber(record.get("maxExp")),
        source:        record.get("source"),
        role:          record.get("role"),
        isNew:         hoursAgo < 24,
        timeText:      hoursAgo < 1 ? "Just posted" : hoursAgo < 24 ? `${hoursAgo}h ago` : daysAgo === 1 ? "Yesterday" : `${daysAgo}d ago`,
        daysAgo,
        workMode:      record.get("workMode"),
        jobType:       record.get("jobType"),
        _salaryMin:    record.get("salaryMin") ? toNumber(record.get("salaryMin")) : null,
        _salaryMax:    record.get("salaryMax") ? toNumber(record.get("salaryMax")) : null,
        _qualityScore: toNumber(record.get("qualityScore"))
      };
    });
  } finally {
    session.close().catch(() => {});
  }

  if (page === 1) {
    const topJobs = diversifyTopK(paginatedJobs, 15);
    setImmediate(async () => {
      try {
        await db.transaction(async (tx) => {
          await tx.delete(jobMatches).where(eq(jobMatches.userId, userId));
          if (!topJobs.length) return;

          await tx.insert(jobsTable).values(
            topJobs.filter(job => job && job.id).map((job) => ({
              sourceJobId: String(job.id),
              title: job.title,
              company: job.company,
              location: job.location,
              sourceUrl: job.url,
              salaryMin: job._salaryMin ?? null,
              salaryMax: job._salaryMax ?? null,
            }))
          ).onConflictDoNothing();

          const rows = topJobs.filter(job => job && job.id).map((job) => ({
            userId,
            jobSourceId:   String(job.id),
            matchedCount:  Number(job.matchedCount)  || 0,
            requiredCount: Number(job.totalRequired) || 0,
            matchPercent:  Number(job.matchPercent)  || 0,
            score:         Number(job._qualityScore) || 0,
            matchedSkills: cleanArray(job.matchedSkills).map(String),
            missingSkills: cleanArray(job.missingSkills).map(String),
          }));

          for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            await tx.insert(jobMatches)
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
        });
      } catch (err) { }
    });
  }

  const finalJobs = paginatedJobs.map(j => {
    const { _salaryMin, _salaryMax, _qualityScore, ...rest } = j;
    return rest;
  });

  return {
    jobs: finalJobs,
    isPro: access.plan === "pro",
    filters: {
      total:          filters.total,
      avgMatch:       filters.avgMatch,
      newJobs:        filters.newJobs,
      perfectMatches: filters.perfectMatches,
    },
  };
}
