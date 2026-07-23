import { generateText } from "ai";
import { openrouter } from "../lib/openai.js";
import logger from "../logger/logger.js";
import { AppError } from "../lib/AppError.js";
import { OperationRegistry, EXECUTOR_TYPES } from "./executor/registry.js";
import { applyPatches, getFragmentByPath } from "./executor/patchEngine.js";

/**
 * Tool Executor Layer — Phase 6B (Patch Engine Integration)
 * The Executor takes an ExecutionPlan, validates operations against the Registry,
 * and groups them by ExecutorType (LLM, DETERMINISTIC, PATCH).
 * It executes operations one at a time, sending patches incrementally to the PatchEngine.
 */
export class ToolExecutor {
  constructor(executionPlan, context) {
    this.plan = executionPlan;
    this.context = context;
  }

  async execute() {
    let currentResume = JSON.parse(JSON.stringify(this.context.masterResumeJson));
    const { platform, requestId } = this.context;
    
    // 1. Validate & Classify operations using the Registry
    const validOperations = [];
    const skippedOperations = [];
    const operationsExecuted = [];
    const operationsFailed = [];
    const sectionsModified = [];

    for (const op of this.plan.operations) {
      const reg = OperationRegistry[op.type];
      if (!reg || typeof reg.validator !== "function" || !reg.validator(op)) {
        skippedOperations.push(op.id);
        continue;
      }
      validOperations.push({
        ...op,
        _executionOrder: reg.executionOrder,
        _executorType: reg.executorType
      });
    }

    if (skippedOperations.length > 0) {
      logger.warn("Tool Executor skipped invalid operations", { requestId, skippedOps: skippedOperations });
    }

    // 2. Sort by Execution Order (from registry), then by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const sortedOps = validOperations.sort((a, b) => {
      if (a._executionOrder !== b._executionOrder) return a._executionOrder - b._executionOrder;
      return (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
    });

    // 3. Dispatch Phase (Incremental Execution Loop)
    let totalGenerationMs = 0;
    
    for (const op of sortedOps) {
      let patchResult = null;
      try {
         if (op._executorType === EXECUTOR_TYPES.LLM) {
            patchResult = await this.executeLlmOperation(op, currentResume, platform);
            totalGenerationMs += patchResult?.generationMs || 0;
         } else if (op._executorType === EXECUTOR_TYPES.DETERMINISTIC) {
            patchResult = await this.executeDeterministicOperation(op, currentResume);
         } else if (op._executorType === EXECUTOR_TYPES.PATCH) {
            patchResult = await this.executePatchOperation(op, currentResume);
         }
         
         if (patchResult) {
            const oldValue = getFragmentByPath(currentResume, patchResult.targetPath);
            // Immediately apply to currentResume
            const applyResult = applyPatches(currentResume, [
               { targetPath: patchResult.targetPath, updatedValue: patchResult.updatedValue, operationId: op.id || op.type }
            ]);
            
            if (applyResult.errors.length > 0) {
               logger.warn("Patch engine failed to apply operation", { opId: op.id, targetPath: op.targetPath, error: applyResult.errors[0] });
               operationsFailed.push(op.id || op.type);
            } else {
               currentResume = applyResult.updatedResume;
               operationsExecuted.push(op.id || op.type);
               sectionsModified.push({
                 targetPath: patchResult.targetPath,
                 oldValue: JSON.stringify(oldValue),
                 newValue: JSON.stringify(patchResult.updatedValue),
                 reason: op.reason
               });
            }
         }
      } catch (err) {
         logger.warn(`Failed to execute operation ${op.type}`, { opId: op.id, error: err.message });
         operationsFailed.push(op.id || op.type);
         // Skip and continue remaining operations
      }
    }
    
    return { 
      parsed: currentResume, 
      generationMs: totalGenerationMs,
      operationsExecuted,
      operationsSkipped,
      operationsFailed,
      sectionsModified
    };
  }

  async executeLlmOperation(op, currentResume, platform) {
     const fragment = getFragmentByPath(currentResume, op.targetPath);
     if (fragment === null) throw new Error("Fragment not found for path");
     
     const prompt = `
You are a resume rewriting executor for the ${platform.toUpperCase()} platform.
You are rewriting ONLY the following JSON fragment located at "${op.targetPath}".

Instruction: ${op.instruction}
Reason: ${op.reason}
Evidence: ${op.evidenceRef || 'None'}
Target Role: ${this.plan.targetRole}
Overall Strategy: ${this.plan.overallStrategy}

ORIGINAL FRAGMENT:
${JSON.stringify(fragment, null, 2)}

Return ONLY the updated JSON value that should replace the original fragment. 
If the original was a string, return a valid JSON string (with quotes).
If it was an array of strings, return a valid JSON array of strings.
Do not output markdown code blocks. Just the raw JSON value.
`;

     const startTime = Date.now();
     const result = await generateText({
        model: openrouter(process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini"),
        prompt,
        temperature: 0.15,
        maxTokens: 1000
     });
     
     const generationMs = Date.now() - startTime;
     const cleanText = result.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
     
     return {
        targetPath: op.targetPath,
        updatedValue: JSON.parse(cleanText),
        generationMs
     };
  }
  
  async executeDeterministicOperation(op, currentResume) {
     // Pure logic, no LLM required
     const fragment = getFragmentByPath(currentResume, op.targetPath);
     return { targetPath: op.targetPath, updatedValue: fragment };
  }
  
  async executePatchOperation(op, currentResume) {
     // Patch using intelligence evidence directly, no LLM required
     const fragment = getFragmentByPath(currentResume, op.targetPath);
     let newText = fragment;
     if (typeof fragment === 'string' && op.evidenceRef) {
         newText = `${fragment} (${op.evidenceRef})`;
     }
     return { targetPath: op.targetPath, updatedValue: newText };
  }
}
