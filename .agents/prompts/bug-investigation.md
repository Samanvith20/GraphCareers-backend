# Purpose

This prompt instructs the AI to rapidly triage and identify the root cause of an application defect.
It focuses the investigation on common GraphCareers failure modes, such as swallowed promises, connection leaks, or misconfigured middleware pipelines.
It ensures the AI uses the established logs and architectural boundaries to track down the issue.

# When to use

- When a specific endpoint is returning unexpected 500 errors or timing out.
- When BullMQ background jobs are stalling or failing silently.
- When the Neo4j graph queries return inconsistent pathing data.
- During active incident response to identify the exact line of failure.

# Required Skills

- `backend-reviewer`

# Instructions to the AI

Activate the `backend-reviewer` skill and systematically analyze the provided error trace or problematic codebase segment against `AGENTS.md`.

1. **Trace the Pipeline**: Check the Express request lifecycle (Section 4). Was the error swallowed by a controller failing to call `next(err)`?
2. **Context Tracking**: Trace the `requestId` across the service boundary. Did the service throw an `AppError` correctly, or did it return a generic fault?
3. **Database Concurrency**: If the bug involves duplicate data, verify that Drizzle inserts are using `.onConflictDoUpdate()` (Section 5) to ensure idempotency.
4. **Graph Connections**: If the bug is a timeout, check the Neo4j service for missing `await session.close()` calls inside `finally` blocks (Section 7).
5. **Worker Failures**: If investigating a worker, verify that the `"failed"` event is hooked into Sentry and that ephemeral files aren't causing disk exhaustion.

# Expected Output

Provide a clear Root Cause Analysis (RCA) detailing exactly why the code violates the repository's expected behavior.
Reference the specific section of `AGENTS.md` that was violated.
Output a code snippet (max 15 lines) demonstrating the exact fix required to resolve the bug.
Explain how the fix restores architectural compliance.

# Success Criteria

The exact root cause of the bug is identified without guessing.
The provided fix conforms to the pure ESM standards and the error handling conventions of GraphCareers.
The solution guarantees that the issue will not silently fail again in the future.
