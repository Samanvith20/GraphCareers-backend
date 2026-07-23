export const EXECUTOR_TYPES = {
  LLM: "LLM", // Requires text generation via AI
  DETERMINISTIC: "DETERMINISTIC", // Pure backend code logic
  PATCH: "PATCH" // Simple verified insertion (no reasoning)
};

export const OperationRegistry = {
  REWRITE_SUMMARY: {
    executorType: EXECUTOR_TYPES.LLM,
    executionOrder: 10,
    retryPolicy: { maxRetries: 2, fallback: "SKIP" },
    supportsRollback: false,
    validator: (op) => !!op.targetPath
  },
  REWRITE_BULLET: {
    executorType: EXECUTOR_TYPES.LLM,
    executionOrder: 20,
    retryPolicy: { maxRetries: 2, fallback: "SKIP" },
    supportsRollback: false,
    validator: (op) => !!op.targetPath && op.targetPath.includes("bullets")
  },
  REWRITE_PROJECT_BULLET: {
    executorType: EXECUTOR_TYPES.LLM,
    executionOrder: 20,
    retryPolicy: { maxRetries: 2, fallback: "SKIP" },
    supportsRollback: false,
    validator: (op) => !!op.targetPath && op.targetPath.includes("projects")
  },
  REORDER_SKILLS: {
    executorType: EXECUTOR_TYPES.DETERMINISTIC,
    executionOrder: 1, // Deterministic operations run first
    retryPolicy: { maxRetries: 0, fallback: "SKIP" },
    supportsRollback: true,
    validator: (op) => !!op.targetPath
  },
  STANDARDIZE_TITLE: {
    executorType: EXECUTOR_TYPES.DETERMINISTIC,
    executionOrder: 2,
    retryPolicy: { maxRetries: 0, fallback: "SKIP" },
    supportsRollback: true,
    validator: (op) => !!op.targetPath
  },
  HIGHLIGHT_KEYWORD: {
    executorType: EXECUTOR_TYPES.PATCH,
    executionOrder: 30, // Patches run last after major rewrites
    retryPolicy: { maxRetries: 1, fallback: "SKIP" },
    supportsRollback: true,
    validator: (op) => !!op.targetPath && !!op.instruction
  },
  ADD_QUANTIFICATION: {
    executorType: EXECUTOR_TYPES.PATCH,
    executionOrder: 30,
    retryPolicy: { maxRetries: 1, fallback: "SKIP" },
    supportsRollback: true,
    validator: (op) => !!op.targetPath && !!op.evidenceRef
  }
};
