import { generateObject } from "ai";
import { openrouter } from "../lib/openai.js";
import { z } from "zod";
import logger from "../logger/logger.js";

// ─── Phase 4: Production-Ready ExecutionPlan Schema ─────────────────────────

const operationSchema = z.object({
  id: z.string().describe("Unique operation ID within the plan (e.g. op-1, op-2)."),
  type: z.enum([
    "REWRITE_SUMMARY",
    "REWRITE_BULLET",
    "REWRITE_PROJECT_BULLET",
    "REORDER_SKILLS",
    "HIGHLIGHT_KEYWORD",
    "ADD_QUANTIFICATION",
    "STANDARDIZE_TITLE",
  ]),
  targetPath: z.string().describe("Exact JSON path being targeted (e.g. summary, experience[0].bullets[1], skills.Backend)."),
  instruction: z.string().describe("Human-readable directive for the executor — what to do at this path."),
  reason: z.string().describe("Why this operation was chosen, grounded in trend data or intelligence."),
  priority: z.enum(["critical", "high", "medium", "low"]),
  expectedAtsImpact: z.string().describe("Expected ATS score impact (e.g. +8, +3, +1)."),
  confidence: z.number().describe("Per-operation confidence score (0-100)."),
  evidenceRef: z.string().nullable().describe("Reference to source evidence from Resume Intelligence (e.g. achievements.quantifiedMetrics[2]), or null."),
  dependsOn: z.array(z.string()).nullable().describe("Array of operation IDs that must execute before this one, or null."),
});

export const executionPlanSchema = z.object({
  targetRole: z.string().describe("The primary role being targeted based on the platform and trends."),
  platform: z.string().describe("Target platform (e.g. naukri, instahyre)."),
  overallStrategy: z.string().describe("A 1-2 sentence high-level strategy for this optimization."),
  confidenceScore: z.number().describe("Overall confidence score of this plan (0-100)."),
  planVersion: z.number().describe("Schema version for forward compatibility. Always output 1."),
  operations: z.array(operationSchema),
  skillRecommendations: z.array(z.object({
    skill: z.string(),
    importance: z.enum(["critical", "high", "medium"]),
    learnMessage: z.string().describe("Actionable message explaining why this skill is needed based on platform demand.")
  })).describe("Skills the candidate DOES NOT HAVE but should learn in the future based on platform demand."),
  structuralRecommendations: z.array(z.string()).describe("Strategic recommendations on how to structure the resume better for the ATS (e.g. summary strategy, project strategy).")
});

/**
 * AI Planner Service — Phase 4
 * Analyzes the OptimizationContext and generates a deterministic execution plan.
 * The Planner is the SOLE reasoning engine — it decides what, why, and priority.
 * Does NOT modify the resume directly.
 *
 * @param {object} context - OptimizationContext with activeVersion, resumeIntelligence
 * @param {object} trends - Platform trends with topSkills, experienceDistribution, etc.
 * @returns {Promise<object|null>} ExecutionPlan or null on failure (enables Legacy fallback)
 */
export async function generateOptimizationPlan(context, trends) {
  const { userId, platform, requestId, activeVersion, resumeIntelligence } = context;

  logger.info("AI Planner starting reasoning phase", {
    requestId,
    userId,
    platform,
  });

  // Build a detailed resume structure map for the planner to reference exact paths
  const resumeJson = typeof activeVersion.snapshotJson === "string"
    ? JSON.parse(activeVersion.snapshotJson)
    : activeVersion.snapshotJson;

  const resumeStructure = buildResumeStructureMap(resumeJson);

  const prompt = `
You are the GraphCareers AI Resume Planner.
Your sole job is to formulate an Execution Plan to optimize a resume for the ${platform.toUpperCase()} platform.
You are the ONLY reasoning engine. The executor that receives your plan will follow your instructions exactly.

══════════════════════════════════════════════════
ABSOLUTE RULES
══════════════════════════════════════════════════
1. DO NOT WRITE RESUME TEXT. Output only a structured plan with operations.
2. EVIDENCE-BASED: You may only reference skills, metrics, or facts that exist in the provided Resume Intelligence.
3. NEVER suggest adding skills, companies, or achievements that are not in the intelligence payload.
4. ATOMICITY: Every operation must target a specific JSON path (e.g. "summary", "experience[0].bullets[1]", "skills.Backend").
5. PRIORITIZE: Operations with higher ATS impact should be marked "critical" or "high".
6. Be specific in instructions — tell the executor EXACTLY what to write or change.

══════════════════════════════════════════════════
PLATFORM DATA (${platform.toUpperCase()})
══════════════════════════════════════════════════
Top Skills Required (with demand percentage across matched jobs):
${trends.topSkills.slice(0, 20).map((s, i) => `${i + 1}. ${s.skill} — ${s.pct}% demand`).join("\n")}

Experience Distribution: ${JSON.stringify(trends.experienceDistribution)}
Work Mode Distribution: ${JSON.stringify(trends.workModeDistribution)}

══════════════════════════════════════════════════
CANDIDATE RESUME INTELLIGENCE (VERIFIED FACTS)
══════════════════════════════════════════════════
Verified Skills: ${JSON.stringify(resumeIntelligence?.skills?.verified || [])}
Skill Categories: ${JSON.stringify(resumeIntelligence?.skills?.categories || {})}
Experience Level: ${resumeIntelligence?.experience?.level || "Unknown"} (${resumeIntelligence?.experience?.totalMonths || 0} months)
Quantified Achievements: ${JSON.stringify(resumeIntelligence?.achievements?.quantifiedMetrics || [])}
Completeness Score: ${resumeIntelligence?.baseline?.completenessScore || 0}/100
Missing Sections: ${JSON.stringify(resumeIntelligence?.baseline?.missingSections || [])}
Strengths: ${JSON.stringify(resumeIntelligence?.baseline?.strengths || [])}
Weaknesses: ${JSON.stringify(resumeIntelligence?.baseline?.weaknesses || [])}

══════════════════════════════════════════════════
RESUME STRUCTURE (exact paths you can target)
══════════════════════════════════════════════════
${resumeStructure}

══════════════════════════════════════════════════
GENERATE YOUR PLAN
══════════════════════════════════════════════════
1. Analyze the gap between the candidate's current resume and the platform's requirements.
2. For each gap, create an operation with a specific targetPath, clear instruction, and evidence-based reasoning.
3. Sort operations by priority (critical first).
4. Determine priority skills the candidate is missing and provide skillRecommendations.
5. Provide structuralRecommendations for ATS strategy (e.g., expanding summary, fixing weak project bullets).
Set planVersion to 1.
`;

  try {
    const { object: executionPlan } = await generateObject({
      model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
      schema: executionPlanSchema,
      prompt,
      temperature: 0.1,
      abortSignal: AbortSignal.timeout(60000),
    });

    logger.info("AI Planner successfully generated execution plan", {
      requestId,
      userId,
      platform,
      operationCount: executionPlan.operations.length,
      confidence: executionPlan.confidenceScore,
      planVersion: executionPlan.planVersion,
      criticalOps: executionPlan.operations.filter(op => op.priority === "critical").length,
    });

    return executionPlan;
  } catch (err) {
    logger.error("AI Planner failed to generate plan", {
      requestId,
      userId,
      platform,
      error: err.message,
    });
    // Fallback: return null so Orchestrator continues with Legacy Optimizer
    return null;
  }
}

/**
 * AI Planner Service — Resume Editor (Phase 8)
 * Generates an ExecutionPlan for a specific manual user edit action.
 */
export async function generateEditPlan(context, editAction) {
  const { userId, requestId, activeVersion, resumeIntelligence } = context;

  logger.info("AI Planner starting edit reasoning", {
    requestId,
    userId,
    action: editAction.actionType
  });

  const resumeJson = typeof activeVersion.snapshotJson === "string"
    ? JSON.parse(activeVersion.snapshotJson)
    : activeVersion.snapshotJson;
    
  const resumeStructure = buildResumeStructureMap(resumeJson);
  
  const prompt = `
You are the GraphCareers AI Resume Planner.
The user has requested a specific edit to their resume.
Your job is to formulate an Execution Plan containing ONLY the operations necessary to fulfill this request.

══════════════════════════════════════════════════
USER REQUEST
══════════════════════════════════════════════════
Action Type: ${editAction.actionType}
Instructions/Context: ${editAction.instructions || "None provided"}
Target Path (if specific): ${editAction.targetPath || "Whole resume or automatic"}

══════════════════════════════════════════════════
CANDIDATE RESUME INTELLIGENCE
══════════════════════════════════════════════════
Verified Skills: ${JSON.stringify(resumeIntelligence?.skills?.verified || [])}
Quantified Achievements: ${JSON.stringify(resumeIntelligence?.achievements?.quantifiedMetrics || [])}

══════════════════════════════════════════════════
CURRENT RESUME STRUCTURE
══════════════════════════════════════════════════
${JSON.stringify(resumeStructure, null, 2)}

══════════════════════════════════════════════════
RULES
══════════════════════════════════════════════════
1. Output ONLY a valid JSON Execution Plan.
2. Generate ONLY the specific operations needed to fulfill the request. If it's a "Rewrite Summary", just output a single REWRITE_SUMMARY operation.
3. If it's a global action (like "Shorten Resume"), you may output multiple REWRITE_BULLET or REWRITE_SUMMARY operations targeting the longest sections.
4. DO NOT WRITE RESUME TEXT in the plan. Output instructions for the Executor.
`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 90_000);

  try {
    const result = await generateObject({
      model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
      schema: executionPlanSchema,
      prompt,
      temperature: 0.2,
      abortSignal: abortController.signal,
    });
    
    return result.object;
  } catch (err) {
    logger.error("AI Planner failed to generate edit plan", { requestId, error: err.message });
    throw new AppError("Failed to generate edit plan: " + err.message, 500);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * AI Planner Service — JD Optimization (Phase 10)
 * Generates an ExecutionPlan specifically tailored to a given Job Description.
 */
export async function generateJdOptimizationPlan(context, jdAnalysis) {
  const { userId, requestId, activeVersion, resumeIntelligence } = context;
  const { jobTitle, companyName, extractedSkills, matchReport } = jdAnalysis;

  logger.info("AI Planner starting JD reasoning phase", {
    requestId,
    userId,
    jobTitle,
    companyName
  });

  const resumeJson = typeof activeVersion.snapshotJson === "string"
    ? JSON.parse(activeVersion.snapshotJson)
    : activeVersion.snapshotJson;
    
  const resumeStructure = buildResumeStructureMap(resumeJson);
  
  const prompt = `
You are the GraphCareers AI Resume Planner.
Your task is to tailor an existing resume for a specific Job Description.
You are the ONLY reasoning engine. Output an Execution Plan that the executor will follow.

══════════════════════════════════════════════════
TARGET ROLE & COMPANY
══════════════════════════════════════════════════
Role: ${jobTitle}
Company: ${companyName}

══════════════════════════════════════════════════
JOB DESCRIPTION EXTRACTION
══════════════════════════════════════════════════
Required Skills: ${JSON.stringify(extractedSkills.requiredSkills)}
Preferred Skills: ${JSON.stringify(extractedSkills.preferredSkills)}
Keywords: ${JSON.stringify(extractedSkills.keywords)}

══════════════════════════════════════════════════
MATCH REPORT (Current Resume vs JD)
══════════════════════════════════════════════════
Overall Match: ${matchReport.overallMatch}%
Strong Skills (Already present): ${JSON.stringify(matchReport.strongSkills)}
Missing Skills: ${JSON.stringify(matchReport.missingSkills)}

══════════════════════════════════════════════════
CANDIDATE INTELLIGENCE (VERIFIED FACTS)
══════════════════════════════════════════════════
Verified Skills: ${JSON.stringify(resumeIntelligence?.skills?.verified || [])}
Quantified Achievements: ${JSON.stringify(resumeIntelligence?.achievements?.quantifiedMetrics || [])}

══════════════════════════════════════════════════
CURRENT RESUME STRUCTURE
══════════════════════════════════════════════════
${JSON.stringify(resumeStructure, null, 2)}

══════════════════════════════════════════════════
RULES
══════════════════════════════════════════════════
1. Only reference skills the candidate ACTUALLY has (from Verified Skills or Strong Skills).
2. DO NOT HALLUCINATE missing skills into the resume if they are not in the candidate's intelligence.
3. If the candidate has a missing skill but it's not prominently displayed, suggest a REWRITE_BULLET to emphasize it.
4. Output a maximum of 8 critical/high priority operations to tailor the summary, experience bullets, and skills section to perfectly match the JD keywords.
5. Provide specific, executable instructions in the plan.
`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 120_000);

  try {
    const result = await generateObject({
      model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
      schema: executionPlanSchema,
      prompt,
      temperature: 0.2,
      abortSignal: abortController.signal,
    });
    
    return result.object;
  } catch (err) {
    logger.error("AI Planner failed to generate JD plan", { requestId, error: err.message });
    throw new AppError("Failed to generate JD edit plan: " + err.message, 500);
  } finally {
    clearTimeout(timeoutId);
  }
}



// ─── Helper: Build human-readable resume structure map ──────────────────────

export function buildResumeStructureMap(json) {
  const lines = [];

  if (json.summary) {
    lines.push("summary — Professional summary (rewritable)");
  }

  if (Array.isArray(json.experience)) {
    json.experience.forEach((exp, i) => {
      lines.push(`experience[${i}] — ${exp.title || "Untitled"} at ${exp.company || "Unknown"} (${exp.startDate || "?"} - ${exp.endDate || "Present"})`);
      if (Array.isArray(exp.bullets)) {
        exp.bullets.forEach((bullet, j) => {
          const preview = bullet.length > 80 ? bullet.substring(0, 80) + "..." : bullet;
          lines.push(`  experience[${i}].bullets[${j}] — "${preview}"`);
        });
      }
    });
  }

  if (Array.isArray(json.projects)) {
    json.projects.forEach((proj, i) => {
      lines.push(`projects[${i}] — ${proj.name || "Untitled"} (${(proj.techStack || []).join(", ")})`);
      if (Array.isArray(proj.bullets)) {
        proj.bullets.forEach((bullet, j) => {
          const preview = bullet.length > 80 ? bullet.substring(0, 80) + "..." : bullet;
          lines.push(`  projects[${i}].bullets[${j}] — "${preview}"`);
        });
      }
    });
  }

  if (json.skills && typeof json.skills === "object") {
    for (const [category, skills] of Object.entries(json.skills)) {
      if (Array.isArray(skills)) {
        lines.push(`skills.${category} — [${skills.join(", ")}]`);
      }
    }
  }

  return lines.join("\n");
}
