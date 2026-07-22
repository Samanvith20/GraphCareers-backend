import { generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { z } from "zod";
import logger from "../logger/logger.js";

// Zod schema matching the Phase 4 Architecture specification
export const executionPlanSchema = z.object({
  targetRole: z.string().describe("The primary role being targeted based on the platform and trends."),
  overallStrategy: z.string().describe("A 1-2 sentence high-level strategy for this optimization."),
  confidenceScore: z.number().describe("Overall confidence score of this plan (0-100)."),
  operations: z.array(z.object({
    type: z.enum([
      "Rewrite_Summary", 
      "Rewrite_Project", 
      "Improve_Experience_Bullet", 
      "Reorder_Skills", 
      "Highlight_Technology", 
      "Add_Missing_Keyword", 
      "Remove_Redundant_Content"
    ]),
    targetSection: z.string().describe("The exact JSON path node being targeted (e.g. experience[0].highlights[1])."),
    reason: z.string().describe("The reasoning behind this operation based on rules and intelligence."),
    priority: z.enum(["High", "Medium", "Low"]),
    expectedAtsImpact: z.string().describe("Expected impact, e.g. +10, +5, etc."),
    confidence: z.number().describe("Confidence score of this specific operation (0-100)."),
    requiredEvidence: z.string().nullable().describe("Evidence required to perform this action (e.g. quantified metric from intelligence), or null if none."),
  })),
});

/**
 * AI Planner Service
 * Analyzes the OptimizationContext and generates a deterministic execution plan.
 * Does NOT modify the resume directly.
 */
export async function generateOptimizationPlan(context, trends) {
  const { userId, platform, requestId, activeVersion, resumeIntelligence } = context;

  logger.info("AI Planner starting reasoning phase", {
    requestId,
    userId,
    platform,
  });

  const prompt = `
You are the GraphCareers AI Resume Planner.
Your sole job is to formulate an Execution Plan to optimize a resume for the ${platform.toUpperCase()} platform.

RULES:
1. DO NOT WRITE RESUME TEXT. Output only a structured plan.
2. Evidence-Based: You may only suggest adding skills or metrics if they exist in the provided Resume Intelligence.
3. Atomicity: Operations must target specific JSON nodes (e.g. 'summary', 'experience[0].highlights[1]').

--- CONTEXT ---
Target Platform: ${platform.toUpperCase()}

Platform Top Skills Needed: 
${trends.topSkills.slice(0, 20).map(s => s.skill).join(", ")}

Candidate Resume Intelligence (VERIFIED FACTS):
${JSON.stringify({
  skills: resumeIntelligence?.skills?.verified || [],
  quantifiedMetrics: resumeIntelligence?.achievements?.quantifiedMetrics || [],
  completeness: resumeIntelligence?.baseline?.completenessScore || 0,
})}

Active Resume Structure (JSON Keys):
${JSON.stringify(Object.keys(activeVersion.snapshotJson || {}))}
`;

  try {
    const { object: executionPlan } = await generateObject({
      model: openrouter("openai/gpt-4o-mini"),
      schema: executionPlanSchema,
      prompt,
      // Abort controller integration (max 60 seconds for planning)
      abortSignal: AbortSignal.timeout(60000),
    });

    logger.info("AI Planner successfully generated execution plan", {
      requestId,
      userId,
      platform,
      operationCount: executionPlan.operations.length,
      confidence: executionPlan.confidenceScore,
    });

    return executionPlan;
  } catch (err) {
    logger.error("AI Planner failed to generate plan (Timeout/Parse Error)", {
      requestId,
      userId,
      error: err.message,
    });
    // Fallback: return null so Orchestrator can continue with Legacy Optimizer
    return null;
  }
}
