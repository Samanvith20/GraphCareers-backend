# Purpose

This prompt focuses the AI on auditing the asynchronous background processing layer built on BullMQ.
It ensures that compute-heavy operations do not starve the HTTP event loop, that ephemeral resources are scrubbed, and that job failures are fully traceable.

# When to use

- When reviewing a new queue worker added to `src/workers/`.
- When diagnosing why a background task (like resume AI extraction) is stalling or silently failing.
- When auditing disk space exhaustion on the shared `/app/uploads` Docker volume.

# Required Skills

- `queue-worker-builder`

# Instructions to the AI

Activate the `queue-worker-builder` skill and evaluate the background job implementation against the rules in `AGENTS.md`.

1. **Ephemeral Cleanup**: Ensure that the worker explicitly utilizes `fs.unlink()` within a `finally` block to remove temporary files from `/app/uploads` (Section 8).
2. **Context Preservation**: Verify that the worker extracts the `requestId` from the job payload and passes it into all Winston logging statements.
3. **Error Hooks**: Confirm that the worker attaches hooks to the `"failed"` event, forwarding the exception and context to `Sentry.captureException()`.
4. **Concurrency Limits**: Check the worker configuration to ensure that concurrency is explicitly capped to prevent the Node runtime from running out of memory (Section 15).
5. **Connection Pooling**: Verify that the worker uses the shared Redis client configuration.

# Expected Output

Provide an operational audit of the worker's resilience.
Flag any missing cleanup blocks that could lead to volume exhaustion.
Output a refactored worker execution loop snippet (max 15 lines) highlighting the `finally` block and Sentry hooks.
Confirm that pure ESM rules are maintained.

# Success Criteria

The background worker executes without leaking memory or disk space.
Job failures are caught, retried safely, and reported to Sentry.
Distributed trace logs remain intact across the async boundary via `requestId`.
The Node container's CPU and memory remain stable due to proper concurrency limits.
