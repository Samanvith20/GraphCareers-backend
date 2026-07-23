import { db } from "../db/index.js";
import { eq, and } from "drizzle-orm";
import {
  optimizationReports,
  resumeVersions,
  resumeWorkspaces,
  resumeWorkspaceIntelligence,
  resumeAnalyses
} from "../db/schema.js";
import { AppError } from "../lib/AppError.js";
import { generateText } from "ai";
import { openrouter } from "../lib/openai.js";
import logger from "../logger/logger.js";

/**
 * Fetches the optimization report for a specific version
 */
export async function getOptimizationReport(versionId, userId) {
  // Validate ownership via workspace
  const [version] = await db
    .select({
      id: resumeVersions.id,
      workspaceId: resumeVersions.workspaceId,
      snapshotJson: resumeVersions.snapshotJson
    })
    .from(resumeVersions)
    .where(eq(resumeVersions.id, versionId));

  if (!version) {
    throw new AppError("Version not found", 404);
  }

  const [workspace] = await db
    .select()
    .from(resumeWorkspaces)
    .where(and(eq(resumeWorkspaces.id, version.workspaceId), eq(resumeWorkspaces.userId, userId)));

  if (!workspace) {
    throw new AppError("Unauthorized access to workspace", 403);
  }

  const [report] = await db
    .select()
    .from(optimizationReports)
    .where(eq(optimizationReports.versionId, versionId));

  if (!report) {
    throw new AppError("No optimization report found for this version", 404);
  }

  return {
    ...report,
    sectionsModified: report.sectionsModified ? JSON.parse(report.sectionsModified) : []
  };
}

/**
 * Assembles the complete Resume Copilot Context
 */
export async function buildCopilotContext(versionId, userId) {
  // 1. Validate version and workspace ownership
  const [version] = await db
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.id, versionId));

  if (!version) throw new AppError("Version not found", 404);

  const [workspace] = await db
    .select()
    .from(resumeWorkspaces)
    .where(and(eq(resumeWorkspaces.id, version.workspaceId), eq(resumeWorkspaces.userId, userId)));

  if (!workspace) throw new AppError("Unauthorized access", 403);

  // 2. Load Resume Intelligence
  const [intelligenceData] = await db
    .select()
    .from(resumeWorkspaceIntelligence)
    .where(eq(resumeWorkspaceIntelligence.workspaceId, workspace.id));

  const intelligence = intelligenceData ? JSON.parse(intelligenceData.intelligenceJson) : null;

  // 3. Load Optimization Report (may be null if not optimized)
  let report = null;
  try {
    report = await getOptimizationReport(versionId, userId);
  } catch (err) {
    // Ignore if not found
  }

  // 4. Load ATS Analysis
  const [analysis] = await db
    .select()
    .from(resumeAnalyses)
    .where(and(eq(resumeAnalyses.versionId, versionId), eq(resumeAnalyses.type, "ats_score")));

  const atsScore = analysis ? JSON.parse(analysis.resultJson) : null;

  // 5. Gather Resume History summary (all versions)
  const history = await db
    .select({
      versionNumber: resumeVersions.versionNumber,
      source: resumeVersions.source,
      createdAt: resumeVersions.createdAt
    })
    .from(resumeVersions)
    .where(eq(resumeVersions.workspaceId, workspace.id))
    .orderBy(resumeVersions.versionNumber);

  return {
    activeVersion: {
      versionNumber: version.versionNumber,
      source: version.source,
      snapshotJson: JSON.parse(version.snapshotJson),
    },
    intelligence,
    optimizationReport: report,
    atsAnalysis: atsScore,
    resumeHistory: history,
    platform: report?.platform || "general"
  };
}

/**
 * Handles the copilot chat request
 */
export async function chatWithCopilot(versionId, userId, message, requestId) {
  // 1. Build the complete context
  const context = await buildCopilotContext(versionId, userId);
  
  // 2. Prepare the LLM prompt
  const systemPrompt = `
You are Resume Copilot, an expert career advisor and resume writer for GraphCareers.
Your goal is to answer the user's questions about their resume and its latest optimization.
Use the provided Context to explain WHY certain changes were made, or to advise them on what to improve next.

===== COPILOT CONTEXT =====
Active Version: v${context.activeVersion.versionNumber} (Source: ${context.activeVersion.source})
Target Platform: ${context.platform}

Resume Intelligence (Facts about the user):
${JSON.stringify(context.intelligence, null, 2)}

Optimization Report (Last changes made):
${JSON.stringify(context.optimizationReport, null, 2)}

ATS Analysis:
${JSON.stringify(context.atsAnalysis, null, 2)}

Complete Resume JSON:
${JSON.stringify(context.activeVersion.snapshotJson, null, 2)}
===========================

Answer the user's message concisely. Focus entirely on the resume, optimization strategies, and ATS scoring.
Be direct, helpful, and reference the specific modifications from the Optimization Report if relevant.
`;

  logger.info("Copilot Chat initiated", { requestId, userId, versionId });

  // 3. Invoke LLM
  const result = await generateText({
    model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
    system: systemPrompt,
    prompt: message,
    temperature: 0.7,
    maxTokens: 800,
  });

  return {
    reply: result.text.trim()
  };
}
