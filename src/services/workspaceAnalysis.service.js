import { db } from "../db/index.js";
import { resumeAnalyses } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import logger from "../logger/logger.js";
import { scoreResume, generateRecommendations } from "./resumeScore.service.js";
import { computeTargetedTrends } from "./targetedTrend.service.js";
import { getVersion } from "./workspaceVersion.service.js";
import { getNeo4jSession } from "../db/neo4j/session.js";
import neo4j from "neo4j-driver";


/**
 * Runs an ATS score analysis on a specific version and upserts the result.
 * Uses the existing scoreResume() function internally.
 */
export async function runAtsAnalysis(workspaceId, versionId, platform, requestId) {
  const version = await getVersion(versionId);
  if (!version) {
    throw new Error("Version not found");
  }

  const structuredJson = JSON.parse(version.snapshotJson);
  const resumeText = JSON.stringify(structuredJson);

  let trends = null;
  let experienceMonths = 0;

  // If platform is specified, try to compute targeted trends
  if (platform) {
    try {
      // We need user skills to query trends — extract from the version snapshot
      const userSkills = structuredJson.skills
        ? Object.values(structuredJson.skills).flat()
        : [];

      // Compute experience from structured resume
      if (structuredJson.experience && Array.isArray(structuredJson.experience)) {
        experienceMonths = structuredJson.experience.reduce(
          (sum, exp) => sum + (exp.experienceMonths || 0),
          0
        );
      }

      // Simple trend computation — get top skills for the platform
      const session = getNeo4jSession(neo4j.session.READ);
      try {
        const result = await session.run(
          `
          MATCH (j:Job)-[:REQUIRES]->(s:Skill)
          WHERE toLower(j.source) = $platform
            AND j.posted_at > datetime() - duration({days: 30})
          WITH s.canonical AS skill, count(DISTINCT j) AS jobCount
          RETURN skill, jobCount
          ORDER BY jobCount DESC LIMIT 30
          `,
          { platform: platform.toLowerCase() },
          { timeout: 15000 }
        );

        const totalJobs = result.records.length > 0 ? 100 : 0; // approximation
        trends = {
          topSkills: result.records.map((r) => ({
            skill: r.get("skill") || "",
            count: r.get("jobCount")?.toNumber?.() ?? r.get("jobCount") ?? 0,
            pct: totalJobs > 0
              ? Math.round(((r.get("jobCount")?.toNumber?.() ?? r.get("jobCount") ?? 0) * 100) / totalJobs)
              : 0,
          })).filter((s) => s.skill),
          experienceDistribution: {},
          workModeDistribution: {},
          avgMinExp: 0,
        };
      } finally {
        await session.close();
      }
    } catch (err) {
      logger.warn("Failed to fetch trends for analysis — using generic scoring", {
        requestId,
        platform,
        error: err.message,
      });
    }
  }

  const scoreResult = scoreResume({
    resumeText,
    structuredJson,
    platform: platform || "generic",
    trends,
    experienceMonths,
  });

  const resultJson = {
    ...scoreResult,
    platform: platform || "generic",
  };

  // Upsert analysis — one per (versionId, type, platform)
  const [analysis] = await db
    .insert(resumeAnalyses)
    .values({
      workspaceId,
      versionId,
      type: "ats_score",
      platform: platform || null,
      resultJson: JSON.stringify(resultJson),
      score: scoreResult.total,
    })
    .onConflictDoUpdate({
      target: [resumeAnalyses.versionId, resumeAnalyses.type, resumeAnalyses.platform],
      set: {
        resultJson: JSON.stringify(resultJson),
        score: scoreResult.total,
      },
    })
    .returning();

  logger.info("ATS analysis completed", {
    requestId,
    workspaceId,
    versionId,
    platform,
    score: scoreResult.total,
  });

  return analysis;
}

/**
 * Gets all analyses for a specific version.
 */
export async function getAnalysesForVersion(versionId) {
  return db
    .select()
    .from(resumeAnalyses)
    .where(eq(resumeAnalyses.versionId, versionId));
}

/**
 * Compares analyses across two versions.
 */
export async function compareVersionAnalyses(versionIdA, versionIdB) {
  const [analysesA, analysesB] = await Promise.all([
    getAnalysesForVersion(versionIdA),
    getAnalysesForVersion(versionIdB),
  ]);

  return { versionA: analysesA, versionB: analysesB };
}
