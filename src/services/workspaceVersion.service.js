import { db } from "../db/index.js";
import { resumeVersions, resumeWorkspaces } from "../db/schema.js";
import { eq, desc, sql } from "drizzle-orm";
import logger from "../logger/logger.js";

/**
 * Creates Version 1 from the master resume's structuredJson.
 * Called internally by getOrCreateWorkspace.
 */
export async function createInitialVersion(workspaceId, structuredJson, requestId) {
  const snapshotJson = typeof structuredJson === "string"
    ? structuredJson
    : JSON.stringify(structuredJson);

  const [version] = await db.insert(resumeVersions).values({
    workspaceId,
    versionNumber: 1,
    snapshotJson,
    source: "upload",
    changeSummary: "Initial resume version from upload",
  }).returning();

  logger.info("Initial workspace version created", { requestId, workspaceId, versionId: version.id });
  return version;
}

/**
 * Creates a new version from an optimization result.
 * Called after an optimization completes successfully.
 */
export async function createVersionFromOptimization(workspaceId, optimizationId, optimizedJson, platform, requestId) {
  // Get current max version number
  const [latest] = await db
    .select({ maxVersion: sql`COALESCE(MAX(${resumeVersions.versionNumber}), 0)` })
    .from(resumeVersions)
    .where(eq(resumeVersions.workspaceId, workspaceId));

  const nextVersion = Number(latest.maxVersion) + 1;

  const snapshotJson = typeof optimizedJson === "string"
    ? optimizedJson
    : JSON.stringify(optimizedJson);

  const [version] = await db.insert(resumeVersions).values({
    workspaceId,
    versionNumber: nextVersion,
    snapshotJson,
    source: "platform_optimize",
    optimizationId,
    sourceMetadata: JSON.stringify({ platform, optimizationId }),
    changeSummary: `Optimized for ${platform} platform`,
  }).returning();

  logger.info("Optimization version created", {
    requestId,
    workspaceId,
    versionId: version.id,
    versionNumber: nextVersion,
    platform,
  });

  return version;
}

/**
 * Lists all versions for a workspace, ordered by versionNumber DESC.
 * Returns lightweight list (no snapshotJson for performance).
 */
export async function listVersions(workspaceId) {
  return db
    .select({
      id: resumeVersions.id,
      versionNumber: resumeVersions.versionNumber,
      source: resumeVersions.source,
      sourceMetadata: resumeVersions.sourceMetadata,
      optimizationId: resumeVersions.optimizationId,
      changeSummary: resumeVersions.changeSummary,
      createdAt: resumeVersions.createdAt,
    })
    .from(resumeVersions)
    .where(eq(resumeVersions.workspaceId, workspaceId))
    .orderBy(desc(resumeVersions.versionNumber));
}

/**
 * Gets a single version by ID with its full snapshot.
 */
export async function getVersion(versionId) {
  const [version] = await db
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.id, versionId));

  return version || null;
}
