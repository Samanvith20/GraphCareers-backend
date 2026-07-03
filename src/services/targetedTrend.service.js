import { getNeo4jSession } from "../db/neo4j/session.js";
import neo4j from "neo4j-driver";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";
import { toNumber } from "../lib/utils.js";

/**
 * Computes targeted skill trends based strictly on the jobs a user actually matched with.
 *
 * @param {string[]} jobSourceIds - Array of job_ids from the user's job_matches table
 * @param {string} requestId - For logging
 * @returns {Promise<object>} Targeted trends { topSkills, experienceDistribution, workModeDistribution }
 */
export async function computeTargetedTrends(jobSourceIds, requestId) {
  if (!jobSourceIds || jobSourceIds.length === 0) {
    logger.warn("No matched jobs provided for targeted trends", { requestId });
    return { topSkills: [], experienceDistribution: {}, workModeDistribution: {}, avgMinExp: 0 };
  }

  const session = getNeo4jSession(neo4j.session.READ);
  try {
    // 1. Fetch skills for exactly these jobs
    const skillResult = await session.run(
      `
      MATCH (j:Job)-[:REQUIRES]->(s:Skill)
      WHERE j.job_id IN $jobIds
      WITH s.canonical AS skill, count(DISTINCT j) AS jobCount
      RETURN skill, jobCount
      ORDER BY jobCount DESC LIMIT 30
      `,
      { jobIds: jobSourceIds }
    );

    const totalJobs = jobSourceIds.length;
    const topSkills = skillResult.records.map((r) => ({
      skill: r.get("skill") || "",
      count: toNumber(r.get("jobCount")) ?? 0,
      pct: totalJobs > 0 ? Math.round((toNumber(r.get("jobCount")) ?? 0) * 100 / totalJobs) : 0,
    })).filter((s) => s.skill);

    // 2. Fetch experience & work mode distribution for these jobs
    const metadataResult = await session.run(
      `
      MATCH (j:Job)
      WHERE j.job_id IN $jobIds
      RETURN j.min_experience AS minExp, j.max_experience AS maxExp, j.work_mode AS workMode
      `,
      { jobIds: jobSourceIds }
    );

    const buckets = { fresher: 0, junior: 0, mid: 0, senior: 0, lead: 0 };
    const workModeDistribution = {};
    let sumMinExp = 0;
    let expJobCount = 0;

    for (const r of metadataResult.records) {
      const minExp = toNumber(r.get("minExp"));
      const mode = r.get("workMode");

      if (mode) {
        workModeDistribution[mode] = (workModeDistribution[mode] || 0) + 1;
      }

      if (minExp !== undefined && minExp !== null) {
        sumMinExp += minExp;
        expJobCount++;
        if (minExp === 0) buckets.fresher++;
        else if (minExp <= 2) buckets.junior++;
        else if (minExp <= 5) buckets.mid++;
        else if (minExp <= 9) buckets.senior++;
        else buckets.lead++;
      }
    }

    const experienceDistribution = {};
    for (const [bucket, count] of Object.entries(buckets)) {
      experienceDistribution[bucket] = expJobCount > 0 ? Math.round((count / expJobCount) * 100) : 0;
    }

    const avgMinExp = expJobCount > 0 ? Math.round(sumMinExp / expJobCount) : 0;

    logger.info("Targeted trends computed", {
      requestId,
      jobCount: totalJobs,
      topSkillsFound: topSkills.length,
    });

    return {
      topSkills,
      experienceDistribution,
      workModeDistribution,
      avgMinExp,
    };
  } catch (err) {
    logger.error("Failed to compute targeted trends", { requestId, error: err.message });
    throw new AppError("Failed to fetch targeted job insights", 500);
  } finally {
    await session.close();
  }
}
