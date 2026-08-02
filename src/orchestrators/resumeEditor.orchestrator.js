import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { 
  resumeOptimizations, 
  optimizationReports,
  users
} from "../db/schema.js";
import { loadWorkspace, activateVersion } from "../services/workspace.service.js";
import { createVersionFromOptimization } from "../services/workspaceVersion.service.js";
import { runAtsAnalysis } from "../services/workspaceAnalysis.service.js";
import { recordEvent } from "../services/workspaceEvent.service.js";
import { generateEditPlan } from "../services/aiPlanner.service.js";
import { generateAndSaveSuggestions } from "../services/suggestions.service.js";
import { ToolExecutor } from "../engines/toolExecutor.engine.js";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";

/**
 * Phase 8: Resume Editing Orchestrator
 * Maps a specific UI edit action to a backend operation.
 * 
 * editAction payload: { actionType: "REWRITE_SUMMARY" | "SHORTEN" | etc, instructions: string, targetPath?: string }
 */
export async function executeResumeEdit(userId, workspaceId, versionId, editAction, requestId) {
  // 1. Load the full workspace to get intelligence and ensure ownership
  const workspacePayload = await loadWorkspace(userId, requestId);
  const { workspace, activeVersion, intelligence } = workspacePayload;

  if (workspace.id !== workspaceId || activeVersion.id !== versionId) {
    throw new AppError("Version mismatch or unauthorized access", 403);
  }

  const context = {
    userId,
    requestId,
    workspace,
    activeVersion,
    resumeIntelligence: intelligence,
  };

  // 2. Generate Execution Plan specifically for this edit action
  const plan = await generateEditPlan(context, editAction);

  if (!plan || plan.operations.length === 0) {
    throw new AppError("AI Planner could not determine any operations for this action", 400);
  }

  // 3. Setup the Tool Executor
  const masterResumeJson = typeof activeVersion.snapshotJson === "string" 
    ? JSON.parse(activeVersion.snapshotJson) 
    : activeVersion.snapshotJson;

  const executor = new ToolExecutor(plan, { 
    masterResumeJson, 
    platform: plan.platform || "general", 
    requestId 
  });

  // 4. Run incremental execution
  const { 
    parsed: updatedJson, 
    generationMs,
    operationsExecuted,
    operationsSkipped,
    operationsFailed,
    sectionsModified 
  } = await executor.execute();

  // 5. Create a fake resumeOptimizations record to track this edit
  const [optRecord] = await db
    .insert(resumeOptimizations)
    .values({ 
      userId, 
      platform: "manual_edit", 
      status: "completed",
      scoreBefore: 0, // We can't know exact score without full trends, or we can fetch previous ATS
      scoreAfter: 0,
      optimizedJson: JSON.stringify(updatedJson),
      masterResumeJson: JSON.stringify(masterResumeJson),
      planJson: JSON.stringify(plan)
    })
    .returning();

  // 6. Create immutable version
  const version = await createVersionFromOptimization(
    workspace.id,
    optRecord.id,
    updatedJson,
    "manual_edit",
    requestId
  );

  // 7. Activate new version
  await activateVersion(userId, workspace.id, version.id, requestId);

  // 8. Run an ATS Analysis
  await runAtsAnalysis(workspace.id, version.id, "general", requestId);

  // 9. Generate and Persist the Optimization Report
  await db.insert(optimizationReports).values({
    versionId: version.id,
    platform: "manual_edit",
    atsBefore: 0,
    atsAfter: 0,
    atsDelta: 0,
    operationsExecuted,
    operationsSkipped,
    operationsFailed,
    sectionsModified: JSON.stringify(sectionsModified),
  });

  // 10. Record Event
  await recordEvent({
    workspaceId: workspace.id,
    userId,
    eventType: "optimization_completed",
    versionId: version.id,
    optimizationId: optRecord.id,
    metadata: { platform: "manual_edit", action: editAction.actionType },
  });

  // Deduct credit
  await db.transaction(async (tx) => {
      const [currentUser] = await tx.select().from(users).where(eq(users.id, userId));
      await tx
        .update(users)
        .set({ credits: Math.max(0, currentUser.credits - 1) })
        .where(eq(users.id, userId));
  });

  logger.info("Resume edit successfully executed", {
    requestId,
    userId,
    versionId: version.id,
    action: editAction.actionType,
    generationMs
  });

  // 12. Generate AI Suggestions asynchronously
  generateAndSaveSuggestions(workspace, version, intelligence, userId).catch(err => {
    logger.error("Background suggestions generation failed", { requestId, versionId: version.id });
  });

  return { success: true, versionId: version.id, updatedJson };
}
