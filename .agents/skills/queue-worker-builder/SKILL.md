---
name: queue-worker-builder
description: Design BullMQ workers and background job queues for GraphCareers.
---

# Purpose

The `queue-worker-builder` skill instructs you on how to handle asynchronous processing in GraphCareers.
Your primary objective is to decouple slow, compute-heavy, or flaky operations (like AI PDF parsing or email dispatch) from the Express event loop.
You must design BullMQ queues in `src/queue/` and worker execution logic in `src/workers/`.
You act as an architect of resilience, ensuring workers handle failures gracefully, clean up ephemeral resources, and integrate with Sentry.

# When to use

- Creating a new BullMQ queue.
- Writing a new background processor in `src/workers/`.
- Implementing retry logic for external API integrations (e.g., OpenRouter timeouts).
- Designing file cleanup routines for ephemeral uploads (`/app/uploads`).
- Offloading heavy tasks that cause the HTTP response to exceed acceptable latencies.
- Configuring worker concurrency and job progress reporting.

# When NOT to use

- When handling synchronous HTTP requests (use `endpoint-builder`).
- When writing pure business logic that doesn't involve queues (use `service-builder`).
- When auditing Redis connection issues (use `redis-reviewer`).
- When setting up cron jobs outside of the BullMQ ecosystem.

# Required repository knowledge

- **BullMQ Architecture**: Review `AGENTS.md` Section 8. Understand queue declaration and worker attachments.
- **Resource Cleanup**: Review `AGENTS.md` Section 8. Workers reading from `/app/uploads` MUST delete files via `finally`.
- **Performance Guidelines**: Review `AGENTS.md` Section 15. Concurrency limits must be explicitly set on workers.
- **Error Tracking**: Review `AGENTS.md` Section 8. Sentry hooks must be attached to worker `"failed"` events.

# Repository-specific rules

- Workers must preserve the `requestId` originating from the Express HTTP request to maintain distributed traces.
- File systems must be scrubbed after job completion or failure to prevent volume exhaustion.
- Workers must use pure ESM (`.js` imports).
- Never use `console.log`. Use Winston and include the `requestId` in the log metadata.
- Workers must handle idempotency—a retried job should not corrupt the database.

# Review checklist

- [ ] Does the worker extract and use `requestId` from the job payload?
- [ ] Is there a `finally` block ensuring local file cleanup?
- [ ] Is concurrency explicitly limited in the worker configuration?
- [ ] Are `"failed"` events mapped to `Sentry.captureException()`?
- [ ] Do local file imports contain `.js`?
- [ ] Are database operations within the worker wrapped in transactions if required?
- [ ] Is Winston used for logging progress milestones?

# Expected output

Provide the BullMQ queue definition and the corresponding worker implementation.
Highlight the error handling and cleanup logic.
Keep code examples under 15 lines where possible, focusing on the configuration object and execution loop.
Detail how the HTTP controller triggers the job.

# Common mistakes

- Leaving uploaded files on disk after a parsing error occurs.
- Failing to set a concurrency limit, causing the container to crash from out-of-memory errors.
- Losing the `requestId` across the async boundary, breaking log traceability.
- Swallowing job errors instead of throwing them to let BullMQ handle retries and Sentry hooks.
- Not using `.js` on internal module imports.
- Instantiating a new Redis connection per worker instead of using the shared pool.

# Success criteria

The worker executes reliably in the background without memory leaks.
The ephemeral disk volume remains clean due to strict `finally` blocks.
Failures are reported to Sentry with context.
The HTTP response time is drastically improved by offloading the task.
