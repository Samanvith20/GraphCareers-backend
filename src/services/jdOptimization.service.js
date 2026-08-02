import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { 
  resumeOptimizations, 
  optimizationReports,
  jdAnalyses,
  users
} from "../db/schema.js";
import { loadWorkspace, activateVersion } from "./workspace.service.js";
import { createVersionFromOptimization } from "./workspaceVersion.service.js";
import { runAtsAnalysis } from "./workspaceAnalysis.service.js";
import { recordEvent } from "./workspaceEvent.service.js";
import { generateJdOptimizationPlan } from "./aiPlanner.service.js";
import { analyzeJobDescription, generateMatchReport } from "./jdAnalysis.service.js";
import { generateAndSaveSuggestions } from "./suggestions.service.js";
import { ToolExecutor } from "../engines/toolExecutor.engine.js";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";

/**
 * Phase 10: JD Optimization Service
 * Tailors an existing resume to a specific job description.
 */
export async function executeJdOptimization(userId, workspaceId, versionId, jdPayload, requestId) {
  const { jobTitle, companyName, jobDescription, platform } = jdPayload;

  // 1. Load the full workspace to get intelligence and ensure ownership
  const workspacePayload = await loadWorkspace(userId, requestId);
  const { workspace, activeVersion, intelligence } = workspacePayload;

  if (workspace.id !== workspaceId || activeVersion.id !== versionId) {
    throw new AppError("Version mismatch or unauthorized access", 403);
  }

  // 2. Extract JD Data
  const jdExtraction = await analyzeJobDescription(jobTitle, companyName, jobDescription);
  
  // 3. Generate Match Report
  const matchReport = generateMatchReport(jdExtraction, intelligence);

  const context = {
    userId,
    requestId,
    workspace,
    activeVersion,
    resumeIntelligence: intelligence,
  };

  const jdAnalysisData = {
    jobTitle,
    companyName,
    platform: platform || "general",
    extractedSkills: jdExtraction,
    matchReport
  };

  // 4. Generate Execution Plan specifically for this JD
  const plan = await generateJdOptimizationPlan(context, jdAnalysisData);

  if (!plan || plan.operations.length === 0) {
    throw new AppError("AI Planner could not determine any operations for this JD.", 400);
  }

  // 5. Setup the Tool Executor
  const masterResumeJson = typeof activeVersion.snapshotJson === "string" 
    ? JSON.parse(activeVersion.snapshotJson) 
    : activeVersion.snapshotJson;

  const executor = new ToolExecutor(plan, { 
    masterResumeJson, 
    platform: platform || "jd_tailored", 
    requestId 
  });

  // 6. Run incremental execution
  const { 
    parsed: updatedJson, 
    generationMs,
    operationsExecuted,
    operationsSkipped,
    operationsFailed,
    sectionsModified 
  } = await executor.execute();

  // 7. Create a fake resumeOptimizations record to track this edit
  const [optRecord] = await db
    .insert(resumeOptimizations)
    .values({ 
      userId, 
      platform: "jd_tailored", 
      status: "completed",
      scoreBefore: 0,
      scoreAfter: 0,
      optimizedJson: JSON.stringify(updatedJson),
      masterResumeJson: JSON.stringify(masterResumeJson),
      planJson: JSON.stringify(plan)
    })
    .returning();

  // 8. Create immutable version
  const version = await createVersionFromOptimization(
    workspace.id,
    optRecord.id,
    updatedJson,
    `Tailored: ${companyName} - ${jobTitle}`,
    requestId
  );

  // 9. Activate new version
  await activateVersion(userId, workspace.id, version.id, requestId);

  // 10. Save JD Analysis Record
  await db.insert(jdAnalyses).values({
    versionId: version.id,
    companyName,
    jobTitle,
    platform: platform || "general",
    extractedSkills: JSON.stringify(jdExtraction),
    extractedResponsibilities: JSON.stringify(jdExtraction.responsibilities),
    extractedKeywords: JSON.stringify(jdExtraction.keywords),
    matchReport: JSON.stringify(matchReport)
  });

  // 11. Run an ATS Analysis
  await runAtsAnalysis(workspace.id, version.id, "general", requestId);

  // 12. Generate and Persist the Optimization Report
  await db.insert(optimizationReports).values({
    versionId: version.id,
    platform: "jd_tailored",
    atsBefore: 0,
    atsAfter: 0,
    atsDelta: 0,
    operationsExecuted,
    operationsSkipped,
    operationsFailed,
    sectionsModified: JSON.stringify(sectionsModified),
  });

  // 13. Record Event
  await recordEvent({
    workspaceId: workspace.id,
    userId,
    eventType: "optimization_completed",
    versionId: version.id,
    optimizationId: optRecord.id,
    metadata: { action: "jd_optimization", companyName, jobTitle },
  });

  // Deduct credit
  await db.transaction(async (tx) => {
      const [currentUser] = await tx.select().from(users).where(eq(users.id, userId));
      await tx
        .update(users)
        .set({ credits: Math.max(0, currentUser.credits - 3) }) // JD opt costs 3 credits
        .where(eq(users.id, userId));
  });

  logger.info("JD Optimization successfully executed", {
    requestId,
    userId,
    versionId: version.id,
    companyName,
    jobTitle,
    generationMs
  });

  // 14. Trigger AI Suggestions Engine asynchronously
  generateAndSaveSuggestions(workspace, version, intelligence, userId).catch(err => {
    logger.error("Background suggestions generation failed", { requestId, versionId: version.id });
  });

  return { success: true, versionId: version.id, updatedJson, matchReport };
}
