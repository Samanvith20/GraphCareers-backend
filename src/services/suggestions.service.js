import { generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { z } from "zod";
import { db } from "../db/index.js";
import { resumeSuggestions } from "../db/schema.js";
import { getOptimizationReport } from "./resumeCopilot.service.js";
import { buildResumeStructureMap } from "./aiPlanner.service.js";
import logger from "../logger/logger.js";
import { eq } from "drizzle-orm";

const suggestionSchema = z.object({
  suggestions: z.array(z.object({
    category: z.enum([
      "MARKET_SKILL",
      "MISSING_METRIC",
      "WEAK_BULLET",
      "SUMMARY_IMPROVEMENT",
      "PROJECT_IMPROVEMENT",
      "ATS_IMPROVEMENT"
    ]),
    title: z.string().describe("Short, actionable title for the user (e.g. 'Quantify Leadership Impact')"),
    description: z.string().describe("1-2 sentence explanation of the suggestion"),
    reason: z.string().describe("Why this matters (e.g. 'ATS systems flag bullets without metrics')"),
    actionType: z.string().describe("The exact actionType for the Phase 8 Editing API (e.g. 'REWRITE_BULLET', 'REWRITE_SUMMARY')"),
    actionPayload: z.object({
      instructions: z.string().describe("Specific instructions for the AI planner to execute this fix"),
      targetPath: z.string().optional().describe("The JSON path to edit (e.g. experience[0].bullets[1])")
    }).describe("The payload that will be sent to the Phase 8 API"),
    priority: z.enum(["critical", "high", "medium", "low"]),
    estimatedImpact: z.number().describe("Expected ATS score improvement (e.g. 5)")
  }))
});

/**
 * AI Suggestions Engine — Phase 9
 * Analyzes the current resume version and context to generate actionable, 1-click executable suggestions.
 */
export async function generateAndSaveSuggestions(workspace, version, intelligence, userId) {
  try {
    let report = null;
    try {
      report = await getOptimizationReport(version.id, userId);
    } catch (e) {
      // no report found, ignore
    }

    const resumeJson = typeof version.snapshotJson === "string" 
      ? JSON.parse(version.snapshotJson) 
      : version.snapshotJson;

    const resumeStructure = buildResumeStructureMap(resumeJson);

    const prompt = `
You are the GraphCareers AI Suggestions Engine.
Analyze the candidate's current resume and generate highly actionable, 1-click suggestions.
These suggestions will be displayed in the UI as buttons the user can click to instantly improve their resume.

══════════════════════════════════════════════════
CANDIDATE INTELLIGENCE
══════════════════════════════════════════════════
${JSON.stringify(intelligence, null, 2)}

══════════════════════════════════════════════════
CURRENT RESUME
══════════════════════════════════════════════════
${JSON.stringify(resumeStructure, null, 2)}

══════════════════════════════════════════════════
OPTIMIZATION REPORT (Recent changes)
══════════════════════════════════════════════════
${report ? JSON.stringify(report, null, 2) : "None available (fresh version)"}

══════════════════════════════════════════════════
RULES
══════════════════════════════════════════════════
1. Generate 3 to 5 suggestions maximum.
2. Focus on missing metrics, weak bullets, ATS keywords, or summary impact.
3. VERY IMPORTANT: The actionType and actionPayload MUST perfectly map to our Editing API. 
   - actionType must be a string like "REWRITE_BULLET", "REWRITE_SUMMARY", "ADD_PROJECT_METRIC".
   - actionPayload.instructions must clearly tell the backend what to do when clicked.
   - actionPayload.targetPath must point exactly to the array index (e.g. experience[0].bullets[2]) if editing a specific bullet.
`;

    const result = await generateObject({
      model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
      schema: suggestionSchema,
      prompt,
      temperature: 0.3,
    });

    const suggestionsToInsert = result.object.suggestions.map(sugg => ({
      versionId: version.id,
      category: sugg.category,
      title: sugg.title,
      description: sugg.description,
      reason: sugg.reason,
      actionType: sugg.actionType,
      actionPayload: JSON.stringify(sugg.actionPayload),
      priority: sugg.priority,
      estimatedImpact: sugg.estimatedImpact
    }));

    if (suggestionsToInsert.length > 0) {
      // Delete any existing suggestions for this version just in case
      await db.delete(resumeSuggestions).where(eq(resumeSuggestions.versionId, version.id));
      await db.insert(resumeSuggestions).values(suggestionsToInsert);
      
      logger.info("AI Suggestions Engine generated suggestions", {
        versionId: version.id,
        count: suggestionsToInsert.length
      });
    }

    return suggestionsToInsert;
  } catch (err) {
    logger.error("AI Suggestions Engine failed", { versionId: version.id, error: err.message });
    // Don't throw, we want suggestions to fail gracefully in the background
    return [];
  }
}

/**
 * Fetches existing suggestions for a given version.
 */
export async function getSuggestions(versionId) {
  const suggestions = await db.select().from(resumeSuggestions).where(eq(resumeSuggestions.versionId, versionId));
  return suggestions.map(s => ({
    ...s,
    actionPayload: JSON.parse(s.actionPayload)
  }));
}
