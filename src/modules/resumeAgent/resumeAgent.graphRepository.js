import neo4j from "neo4j-driver";
import { getNeo4jSession } from "../../db/neo4j/session.js";
import logger from "../../logger/logger.js";
import {
  platformLocationSearchTokens,
  platformRoleSearchTokens,
  platformSourceAliases,
  rankPlatformJobCandidates,
} from "./domain/platformSelection.js";

const PLATFORM_JOB_QUERY = `
  MATCH (j:Job)
  WHERE (
      j.source_normalized IN $sourceAliases
      OR (j.source_normalized IS NULL AND toLower(trim(coalesce(j.source, ""))) IN $sourceAliases)
    )
    AND (j.expires_at IS NULL OR j.expires_at > datetime())
    AND j.posted_at IS NOT NULL
    AND j.posted_at >= datetime($fromDate)
  OPTIONAL MATCH (j)-[:MAPS_TO]->(r:Role)
  WITH j,
       collect(DISTINCT r.role_title) AS roleTitles,
       toLower(coalesce(j.title, "")) AS jobTitle,
       toLower(coalesce(j.location, "") + " " + coalesce(j.location_state, "") + " " + coalesce(j.location_country, "")) AS locationText
  WITH j, roleTitles,
       [token IN $roleTokens WHERE jobTitle CONTAINS token OR any(roleTitle IN roleTitles WHERE toLower(roleTitle) CONTAINS token)] AS matchedRoleTokens,
       [token IN $locationTokens WHERE locationText CONTAINS token] AS matchedLocationTokens
  WHERE size(matchedRoleTokens) > 0
  WITH j, roleTitles, size(matchedRoleTokens) AS roleTokenMatches, size(matchedLocationTokens) AS locationTokenMatches
  ORDER BY locationTokenMatches DESC, roleTokenMatches DESC, j.posted_at DESC
  LIMIT $candidateLimit
  OPTIONAL MATCH (j)-[:REQUIRES]->(s:Skill)
  WITH j, roleTitles, collect(DISTINCT s.canonical) AS technicalSkills
  OPTIONAL MATCH (j)-[:USES_TOOL]->(t:Tool)
  WITH j, roleTitles, technicalSkills, collect(DISTINCT t.name) AS tools
  OPTIONAL MATCH (j)-[:POSTED_BY]->(c:Company)
  RETURN
    toString(j.job_id) AS sourceJobId,
    j.title AS title,
    roleTitles[0] AS roleTitle,
    j.source AS source,
    j.source_url AS sourceUrl,
    c.name AS company,
    j.location AS location,
    j.location_state AS locationState,
    j.location_country AS locationCountry,
    j.work_mode AS workMode,
    j.job_type AS jobType,
    j.industry AS industry,
    j.min_experience AS minExp,
    j.max_experience AS maxExp,
    CASE WHEN j.posted_at IS NULL THEN null ELSE toString(j.posted_at) END AS postedAt,
    j.description AS description,
    technicalSkills,
    tools
`;

const PLATFORM_ROLE_OPTIONS_QUERY = `
  MATCH (j:Job)-[:MAPS_TO]->(r:Role)
  WHERE (
      j.source_normalized IN $sourceAliases
      OR (j.source_normalized IS NULL AND toLower(trim(coalesce(j.source, ""))) IN $sourceAliases)
    )
    AND (j.expires_at IS NULL OR j.expires_at > datetime())
    AND j.posted_at IS NOT NULL
    AND j.posted_at >= datetime($fromDate)
    AND r.role_title IS NOT NULL
  WITH trim(r.role_title) AS name, count(DISTINCT j) AS jobCount
  WHERE name <> "" AND ($search = "" OR toLower(name) CONTAINS $search)
  RETURN name, jobCount
  ORDER BY jobCount DESC, name
  LIMIT $limit
`;

const PLATFORM_ROLE_AVAILABILITY_QUERY = `
  MATCH (j:Job)-[:MAPS_TO]->(r:Role)
  WHERE (
      j.source_normalized IN $sourceAliases
      OR (j.source_normalized IS NULL AND toLower(trim(coalesce(j.source, ""))) IN $sourceAliases)
    )
    AND (j.expires_at IS NULL OR j.expires_at > datetime())
    AND j.posted_at IS NOT NULL
    AND j.posted_at >= datetime($fromDate)
    AND toLower(trim(coalesce(r.role_title, ""))) = $role
  RETURN trim(r.role_title) AS name, count(DISTINCT j) AS jobCount
  LIMIT 1
`;

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (neo4j.isInt(value)) return value.toNumber();
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

function platformAgeWindow() {
  const maximumAgeDays = Number(process.env.RESUME_AGENT_PLATFORM_MAX_AGE_DAYS) || 7;
  return {
    maximumAgeDays,
    fromDate: new Date(Date.now() - maximumAgeDays * 86_400_000).toISOString(),
  };
}

export async function listPlatformRolesFromGraph({ platform, search = "", limit = 100, requestId }) {
  const session = getNeo4jSession(neo4j.session.READ);
  const sourceAliases = platformSourceAliases(platform);
  const { maximumAgeDays, fromDate } = platformAgeWindow();
  try {
    const result = await session.run(
      PLATFORM_ROLE_OPTIONS_QUERY,
      {
        sourceAliases,
        fromDate,
        search: String(search).trim().toLowerCase(),
        limit: neo4j.int(limit),
      },
      { timeout: Number(process.env.RESUME_AGENT_GRAPH_TIMEOUT_MS) || 15_000 },
    );
    const roles = result.records.map((record) => ({
      name: record.get("name"),
      jobCount: toNumber(record.get("jobCount")) || 0,
    }));
    logger.info("Resume Agent platform roles loaded from Neo4j", {
      requestId,
      platform,
      maximumAgeDays,
      roleCount: roles.length,
    });
    return { roles, maximumAgeDays };
  } finally {
    await session.close();
  }
}

export async function findAvailablePlatformRoleFromGraph({ platform, role }) {
  const session = getNeo4jSession(neo4j.session.READ);
  const sourceAliases = platformSourceAliases(platform);
  const { fromDate } = platformAgeWindow();
  try {
    const result = await session.run(
      PLATFORM_ROLE_AVAILABILITY_QUERY,
      { sourceAliases, fromDate, role: String(role).trim().toLowerCase() },
      { timeout: Number(process.env.RESUME_AGENT_GRAPH_TIMEOUT_MS) || 15_000 },
    );
    const record = result.records[0];
    return record ? {
      name: record.get("name"),
      jobCount: toNumber(record.get("jobCount")) || 0,
    } : null;
  } finally {
    await session.close();
  }
}

function recordToPlatformJob(record) {
  return {
    sourceJobId: record.get("sourceJobId"),
    title: record.get("title"),
    roleTitle: record.get("roleTitle"),
    source: record.get("source"),
    sourceUrl: record.get("sourceUrl"),
    company: record.get("company"),
    location: record.get("location"),
    locationState: record.get("locationState"),
    locationCountry: record.get("locationCountry"),
    workMode: record.get("workMode"),
    jobType: record.get("jobType"),
    industry: record.get("industry") || [],
    minExp: toNumber(record.get("minExp")),
    maxExp: toNumber(record.get("maxExp")),
    postedAt: record.get("postedAt"),
    description: record.get("description") || "",
    skillsTechnical: record.get("technicalSkills") || [],
    skillsTools: record.get("tools") || [],
  };
}

export async function listPlatformJobsFromGraph({ platform, role, location, sampleSize, requestId }) {
  const session = getNeo4jSession(neo4j.session.READ);
  const sourceAliases = platformSourceAliases(platform);
  const roleTokens = platformRoleSearchTokens(role);
  const locationTokens = platformLocationSearchTokens(location);
  const candidateLimit = Math.max(500, Math.min(2000, sampleSize * 10));
  const { maximumAgeDays, fromDate } = platformAgeWindow();
  try {
    const result = await session.run(
      PLATFORM_JOB_QUERY,
      { sourceAliases, roleTokens, locationTokens, fromDate, candidateLimit: neo4j.int(candidateLimit) },
      { timeout: Number(process.env.RESUME_AGENT_GRAPH_TIMEOUT_MS) || 15_000 },
    );
    const candidates = result.records.map(recordToPlatformJob);
    const selection = rankPlatformJobCandidates(candidates, { role, location, sampleSize });
    logger.info("Resume Agent platform jobs selected from Neo4j", {
      requestId,
      platform,
      role,
      maximumAgeDays,
      ...selection.metadata,
      selectedCount: selection.jobs.length,
    });
    return selection;
  } finally {
    await session.close();
  }
}
