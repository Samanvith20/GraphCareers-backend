import { db } from "../db/index.js";
import {
  resumeWorkspaces,
  resumeVersions,
  resumeAnalyses,
  resumeEvents,
  resumes,
} from "../db/schema.js";
import { eq, desc } from "drizzle-orm";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";
import { createInitialVersion } from "./workspaceVersion.service.js";
import { recordEvent } from "./workspaceEvent.service.js";
import { buildWorkspaceIntelligence, CURRENT_INTELLIGENCE_VERSION } from "../engines/resumeIntelligence.engine.js";
import { resumeWorkspaceIntelligence } from "../db/schema.js";

/**
 * Creates or retrieves the workspace for a user.
 * Auto-creates Version 1 from the current master resume if workspace is new.
 */
export async function getOrCreateWorkspace(userId, requestId) {
  // 1. Fetch user's master resume
  const resume = await db.query.resumes.findFirst({
    where: eq(resumes.userId, userId),
  });

  if (!resume || !resume.structuredJson) {
    throw new AppError("Upload and parse a resume first to create your workspace.", 404);
  }

  // 2. Check for existing workspace
  const [existing] = await db
    .select()
    .from(resumeWorkspaces)
    .where(eq(resumeWorkspaces.resumeId, resume.id));

  if (existing) {
    return existing;
  }

  // 3. Create new workspace + Version 1 atomically
  const [workspace] = await db.insert(resumeWorkspaces).values({
    userId,
    resumeId: resume.id,
    status: "idle",
  }).returning();

  const version = await createInitialVersion(
    workspace.id,
    resume.structuredJson,
    requestId
  );

  // Update workspace with active version and version count
  await db
    .update(resumeWorkspaces)
    .set({
      activeVersionId: version.id,
      totalVersions: 1,
      status: "ready",
      updatedAt: new Date(),
    })
    .where(eq(resumeWorkspaces.id, workspace.id));

  // Record events
  await recordEvent({
    workspaceId: workspace.id,
    userId,
    eventType: "workspace_created",
    metadata: { resumeId: resume.id },
  });

  await recordEvent({
    workspaceId: workspace.id,
    userId,
    eventType: "version_created",
    versionId: version.id,
    metadata: { versionNumber: 1, source: "upload" },
  });

  logger.info("Workspace created with initial version", {
    requestId,
    userId,
    workspaceId: workspace.id,
    versionId: version.id,
  });

  // Build initial intelligence (synchronous to ensure it's available on first load)
  await buildWorkspaceIntelligence(workspace.id, resume.structuredJson);

  // Re-fetch to get updated fields
  const [updated] = await db
    .select()
    .from(resumeWorkspaces)
    .where(eq(resumeWorkspaces.id, workspace.id));

  return updated;
}

/**
 * Loads the full workspace with active version, all versions, latest analyses, and events.
 * This is the primary "load workspace" call used by the frontend.
 */
export async function loadWorkspace(userId, requestId) {
  const workspace = await getOrCreateWorkspace(userId, requestId);

  // Fetch all versions (lightweight — no snapshotJson)
  const versions = await db
    .select({
      id: resumeVersions.id,
      versionNumber: resumeVersions.versionNumber,
      source: resumeVersions.source,
      sourceMetadata: resumeVersions.sourceMetadata,
      changeSummary: resumeVersions.changeSummary,
      createdAt: resumeVersions.createdAt,
    })
    .from(resumeVersions)
    .where(eq(resumeVersions.workspaceId, workspace.id))
    .orderBy(desc(resumeVersions.versionNumber));

  // Fetch active version with full snapshot
  let activeVersion = null;
  if (workspace.activeVersionId) {
    const [av] = await db
      .select()
      .from(resumeVersions)
      .where(eq(resumeVersions.id, workspace.activeVersionId));
    if (av) {
      activeVersion = {
        ...av,
        snapshotJson: av.snapshotJson ? JSON.parse(av.snapshotJson) : null,
      };
    }
  }

  // Fetch latest analyses
  const latestAnalyses = await db
    .select()
    .from(resumeAnalyses)
    .where(eq(resumeAnalyses.workspaceId, workspace.id))
    .orderBy(desc(resumeAnalyses.createdAt))
    .limit(10);

  // Fetch recent events
  const recentEvents = await db
    .select()
    .from(resumeEvents)
    .where(eq(resumeEvents.workspaceId, workspace.id))
    .orderBy(desc(resumeEvents.createdAt))
    .limit(10);

  // Lazy Upgrade Strategy
  if (workspace.intelligenceVersion < CURRENT_INTELLIGENCE_VERSION && activeVersion) {
    logger.info("Triggering lazy intelligence upgrade", { workspaceId: workspace.id });
    // Fire and forget in the background
    buildWorkspaceIntelligence(workspace.id, activeVersion.snapshotJson).catch((err) => {
      logger.error("Lazy intelligence upgrade failed", { workspaceId: workspace.id, error: err.message });
    });
  }

  // Fetch current intelligence payload
  const [intelligence] = await db
    .select()
    .from(resumeWorkspaceIntelligence)
    .where(eq(resumeWorkspaceIntelligence.workspaceId, workspace.id));

  return {
    workspace: {
      id: workspace.id,
      status: workspace.status,
      totalVersions: workspace.totalVersions,
      totalOptimizations: workspace.totalOptimizations,
      lastAnalyzedAt: workspace.lastAnalyzedAt,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
    activeVersion,
    versions,
    latestAnalyses: latestAnalyses.map((a) => ({
      id: a.id,
      type: a.type,
      platform: a.platform,
      score: a.score,
      createdAt: a.createdAt,
    })),
    recentEvents: recentEvents.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      versionId: e.versionId,
      metadata: e.metadata ? JSON.parse(e.metadata) : null,
      createdAt: e.createdAt,
    })),
    intelligence: intelligence ? {
      engineVersion: intelligence.engineVersion,
      ...JSON.parse(intelligence.intelligenceJson),
    } : null,
  };
}

/**
 * Sets a specific version as the active version.
 */
export async function activateVersion(userId, workspaceId, versionId, requestId) {
  // Verify workspace belongs to user
  const [workspace] = await db
    .select()
    .from(resumeWorkspaces)
    .where(eq(resumeWorkspaces.id, workspaceId));

  if (!workspace || workspace.userId !== userId) {
    throw new AppError("Workspace not found", 404);
  }

  // Verify version belongs to workspace
  const [version] = await db
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.id, versionId));

  if (!version || version.workspaceId !== workspaceId) {
    throw new AppError("Version not found in this workspace", 404);
  }

  // Update active version
  await db
    .update(resumeWorkspaces)
    .set({
      activeVersionId: versionId,
      updatedAt: new Date(),
    })
    .where(eq(resumeWorkspaces.id, workspaceId));

  await recordEvent({
    workspaceId,
    userId,
    eventType: "version_activated",
    versionId,
    metadata: { versionNumber: version.versionNumber },
  });

  logger.info("Version activated", {
    requestId,
    workspaceId,
    versionId,
    versionNumber: version.versionNumber,
  });

  return {
    workspace: { id: workspaceId },
    activeVersion: {
      id: version.id,
      versionNumber: version.versionNumber,
    },
  };
}
