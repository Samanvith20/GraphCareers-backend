import { generateText } from "ai";
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

    const compactIntelligence = {
      skills: intelligence?.skills?.verified || [],
      baseline: {
        completenessScore: intelligence?.baseline?.completenessScore,
        missingSections: intelligence?.baseline?.missingSections,
        weaknesses: intelligence?.baseline?.weaknesses,
      },
      metrics: (intelligence?.achievements?.quantifiedMetrics || []).slice(0, 5),
      experienceLevel: intelligence?.experience?.level,
    };

    const prompt = `
You are the GraphCareers AI Suggestions Engine.
Analyze the candidate's current resume and generate 3 to 5 highly actionable, 1-click suggestions.
Respond ONLY with a valid JSON object wrapped in {"suggestions": [...]}. Do NOT include Markdown fences.

Required JSON Structure:
{
  "suggestions": [
    {
      "category": "MARKET_SKILL", // or MISSING_METRIC, WEAK_BULLET, SUMMARY_IMPROVEMENT, PROJECT_IMPROVEMENT, ATS_IMPROVEMENT
      "title": "Short actionable title",
      "description": "1-2 sentence explanation",
      "reason": "Why this matters for ATS/recruiters",
      "actionType": "REWRITE_BULLET", // or REWRITE_SUMMARY, ADD_PROJECT_METRIC
      "actionPayload": {
        "instructions": "Specific instruction for the editor",
        "targetPath": "experience[0].bullets[1]"
      },
      "priority": "high", // critical, high, medium, low
      "estimatedImpact": 5
    }
  ]
}

══════════════════════════════════════════════════
CANDIDATE INTELLIGENCE SUMMARY
══════════════════════════════════════════════════
${JSON.stringify(compactIntelligence)}

══════════════════════════════════════════════════
CURRENT RESUME STRUCTURE
══════════════════════════════════════════════════
${resumeStructure}

══════════════════════════════════════════════════
OPTIMIZATION REPORT (Recent changes)
══════════════════════════════════════════════════
${report ? JSON.stringify(report) : "None available"}
`;

    const { text } = await generateText({
      model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
      prompt,
      temperature: 0.2,
    });

    const cleanText = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsedData = JSON.parse(cleanText);
    const suggestionsArray = Array.isArray(parsedData) ? parsedData : (parsedData.suggestions || []);

    const suggestionsToInsert = suggestionsArray.map(sugg => ({
      versionId: version.id,
      category: sugg.category || "ATS_IMPROVEMENT",
      title: sugg.title || "Improve Resume Quality",
      description: sugg.description || "",
      reason: sugg.reason || "",
      actionType: sugg.actionType || "REWRITE_BULLET",
      actionPayload: typeof sugg.actionPayload === "string" ? sugg.actionPayload : JSON.stringify(sugg.actionPayload || {}),
      priority: sugg.priority || "medium",
      estimatedImpact: Number(sugg.estimatedImpact) || 3
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
    logger.error("AI Suggestions Engine failed", {
      versionId: version.id,
      error: err.message,
      cause: err.cause,
      stack: err.stack,
    });
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
