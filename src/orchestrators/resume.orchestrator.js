import { db } from "../db/index.js";
import { resumeOptimizations, users } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { resumeOptimizationQueue } from "../queue/resumeOptimizationQueue.js";
import { consumeUserCredits, getUserAccessFromUser } from "../services/userAccess.service.js";
import { AppError } from "../lib/AppError.js";
import logger from "../logger/logger.js";
import { optimizeResumeForPlatform, fetchPlatformTrends } from "../services/resumeOptimizer.service.js";
import { loadWorkspace, activateVersion, getOrCreateWorkspace } from "../services/workspace.service.js";
import { createVersionFromOptimization } from "../services/workspaceVersion.service.js";
import { runAtsAnalysis } from "../services/workspaceAnalysis.service.js";
import { recordEvent } from "../services/workspaceEvent.service.js";
import { generateOptimizationPlan } from "../services/aiPlanner.service.js";

/**
 * Triggers a platform optimization job. Handles limits, queues the background job.
 */
export async function queuePlatformOptimization(userId, platform, requestId) {
  const idempotencyKey = `${userId}-${platform}`;

  // 1. Check credits
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const access = getUserAccessFromUser(user);
  if (user.credits < 2 && access.tier !== "PRO") {
    throw new AppError("Insufficient credits. Resume optimization requires 2 credits.", 402);
  }

  // 2. Queue Job
  const jobId = idempotencyKey;
  await resumeOptimizationQueue.add(
    "optimizeResume",
    { userId, platform, requestId },
    { jobId } // Deduplicates active jobs natively in BullMQ
  );

  // 3. Upsert pending record
  await db
    .insert(resumeOptimizations)
    .values({ userId, platform, status: "pending", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [resumeOptimizations.userId, resumeOptimizations.platform],
      set: { status: "pending", errorMessage: null, updatedAt: new Date() },
    });

  logger.info("Resume optimization queued via orchestrator", { requestId, userId, platform });

  return {
    success: true,
    message: "Resume optimization started",
    status: "pending",
  };
}

/**
 * Retrieves the status of an ongoing optimization and its full payload if completed.
 */
export async function getOptimizationStatus(userId, platform, requestId) {
  const [optRecord] = await db
    .select()
    .from(resumeOptimizations)
    .where(and(eq(resumeOptimizations.userId, userId), eq(resumeOptimizations.platform, platform)));

  if (!optRecord) {
    throw new AppError("Optimization not found for this platform", 404);
  }

  const response = {
    success: true,
    platform: optRecord.platform,
    status: optRecord.status,
    createdAt: optRecord.createdAt,
    updatedAt: optRecord.updatedAt,
  };

  if (optRecord.status === "completed") {
    const optimizedResume = optRecord.optimizedJson ? JSON.parse(optRecord.optimizedJson) : null;
    const masterResume = optRecord.masterResumeJson ? JSON.parse(optRecord.masterResumeJson) : null;
    const scoreDetails = optRecord.scoreDetails ? JSON.parse(optRecord.scoreDetails) : null;
    const skillRecs = optRecord.skillRecommendations ? JSON.parse(optRecord.skillRecommendations) : [];

    response.atsScores = {
      before: optRecord.scoreBefore,
      after: optRecord.scoreAfter,
      improvement: (optRecord.scoreAfter ?? 0) - (optRecord.scoreBefore ?? 0),
      breakdown: {
        before: scoreDetails?.before ?? null,
        after: scoreDetails?.after ?? null,
      },
    };

    response.optimizedResume = {
      contact: optimizedResume?.contact ?? masterResume?.contact ?? null,
      summary: optimizedResume?.summary ?? masterResume?.summary ?? null,
      experience: optimizedResume?.experience ?? masterResume?.experience ?? [],
      projects: optimizedResume?.projects ?? masterResume?.projects ?? [],
      skills: optimizedResume?.skills ?? masterResume?.skills ?? {},
      education: optimizedResume?.education ?? masterResume?.education ?? [],
      certifications: optimizedResume?.certifications ?? masterResume?.certifications ?? [],
      optimizationNotes: optimizedResume?.optimizationNotes ?? [],
    };

    response.keywords = {
      matched: optRecord.keywordsMatched ?? [],
      missing: optRecord.keywordsMissing ?? [],
      added: optRecord.keywordsAdded ?? [],
    };

    response.skillRecommendations = skillRecs;

    response.platformInsights = {
      topSkills: scoreDetails?.topPlatformSkills ?? [],
      experienceDistribution: scoreDetails?.experienceDistribution ?? {},
      workModeDistribution: scoreDetails?.workModeDistribution ?? {},
    };

    response.recommendations = scoreDetails?.structuralRecommendations ?? [];
  } else if (optRecord.status === "failed") {
    response.errorMessage = optRecord.errorMessage;
  }

  return response;
}

/**
 * Executes the optimization and integrates with the Workspace layer.
 */
export async function executePlatformOptimization(userId, platform, requestId) {
  // 1. Load the full workspace (creates it if it doesn't exist)
  const workspacePayload = await loadWorkspace(userId, requestId);
  const { workspace, activeVersion, intelligence } = workspacePayload;

  if (!activeVersion) {
    throw new Error("Cannot optimize without an active version in the workspace.");
  }

  // 2. Build OptimizationContext
  const context = {
    userId,
    platform,
    requestId,
    workspace,
    activeVersion,
    resumeIntelligence: intelligence,
  };

  // 3. Fetch Platform Trends early so Planner and Optimizer can share them
  const { trends, jobSourceIds } = await fetchPlatformTrends(context);
  context.trends = trends;
  context.jobSourceIds = jobSourceIds;

  // 4. Run AI Planner (Phase 4)
  const plan = await generateOptimizationPlan(context, trends);

  // 5. Run the legacy optimizer using the context
  const result = await optimizeResumeForPlatform(context);
  const optId = result.optRecordId;

  // 6. Fetch the optimization record to get the JSON payload
  const [optRecord] = await db
    .select()
    .from(resumeOptimizations)
    .where(eq(resumeOptimizations.id, optId));

  if (!optRecord || !optRecord.optimizedJson) {
    throw new Error("Optimization record or optimized JSON not found after successful generation");
  }

  // Save the AI plan to the optimization record
  if (plan) {
    await db
      .update(resumeOptimizations)
      .set({ planJson: JSON.stringify(plan) })
      .where(eq(resumeOptimizations.id, optId));
  }

  const optimizedJson = JSON.parse(optRecord.optimizedJson);

  // 5. Create an immutable version snapshot from the optimization
  const version = await createVersionFromOptimization(
    workspace.id,
    optId,
    optimizedJson,
    platform,
    requestId
  );

  // 6. Activate this new version in the workspace
  await activateVersion(userId, workspace.id, version.id, requestId);

  // 7. Run an ATS Analysis on the new version
  await runAtsAnalysis(workspace.id, version.id, platform, requestId);

  // 8. Emit optimization completed event for the workspace
  await recordEvent({
    workspaceId: workspace.id,
    userId,
    eventType: "optimization_completed",
    versionId: version.id,
    optimizationId: optId,
    metadata: { platform, scoreAfter: optRecord.scoreAfter },
  });

  logger.info("Platform optimization integrated into workspace", {
    requestId,
    userId,
    workspaceId: workspace.id,
    versionId: version.id,
    platform,
  });

  return { success: true, versionId: version.id };
}
