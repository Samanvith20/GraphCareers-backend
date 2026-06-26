---
name: performance-reviewer
description: Audit GraphCareers for bottlenecks, N+1 queries, and resource exhaustion.
---

# Purpose

The `performance-reviewer` skill directs you to analyze GraphCareers through a systems engineering lens.
Your goal is to identify and resolve computational bottlenecks, unbounded memory usage, and inefficient data retrieval.
You act as a system profiler, evaluating PostgreSQL query plans, connection pools, worker concurrency, and metric instrumentation.
Ensuring the Node.js event loop remains unblocked is your primary objective.

# When to use

- Reviewing PRs that introduce multi-table joins or complex aggregations in Drizzle.
- Investigating high CPU or out-of-memory container crashes.
- Auditing configuration for PostgreSQL and Neo4j connection pools.
- Reviewing BullMQ concurrency limits on AI parsing workers.
- Checking the lifecycle of ephemeral files to ensure disk I/O performance.
- Validating the `/metrics` endpoint and Prom-client timers.

# When NOT to use

- When conducting security vulnerability sweeps (use `security-reviewer`).
- When building new Express endpoints from scratch (use `endpoint-builder`).
- When writing pure business logic without data volume concerns (use `service-builder`).
- When formatting code to pass standard stylistic rules (use `backend-reviewer`).

# Required repository knowledge

- **Connection Caps**: Review `AGENTS.md` Section 15. Drizzle pools must have connection limits (max 10). Neo4j drivers must be similarly capped.
- **Worker Concurrency**: Review `AGENTS.md` Section 15. Unbounded BullMQ concurrency causes memory exhaustion.
- **Neo4j Resource Leaks**: Review `AGENTS.md` Section 7. Session closures in a `finally` block are critical for performance.
- **File Lifecycle**: Review `AGENTS.md` Section 8. Unlinked ephemeral files prevent disk degradation.
- **Metrics Instrumentation**: Review `AGENTS.md` Section 15. Utilize Prom-client for latency tracking.

# Repository-specific rules

- Any synchronous block of code that iterates over large datasets in the controller layer must be flagged.
- N+1 query patterns in Drizzle must be refactored using `.leftJoin()` or batching.
- File streams should be preferred over buffering large PDFs entirely into memory.
- Monitor API limits and token expenditures (e.g., `aiUsageLogs`).
- Imports must use pure ESM (`.js` extension).

# Review checklist

- [ ] Are database connection pools explicitly capped?
- [ ] Is BullMQ worker concurrency restricted to a safe integer?
- [ ] Are N+1 database queries avoided via joins or batch fetching?
- [ ] Are Neo4j sessions closed to prevent memory/socket bloat?
- [ ] Are large files streamed or deleted rapidly after use via `finally`?
- [ ] Are performance metrics updated via Prom-client middleware?
- [ ] Do local imports correctly append `.js`?

# Expected output

Provide a concise performance profiling report.
Quantify the potential bottleneck (e.g., "This loop generates 50 DB calls").
Provide an optimized code alternative (under 15 lines).
Reference Section 15 of `AGENTS.md` where appropriate.

# Common mistakes

- Querying users and then iterating through the array to query resumes individually (N+1).
- Setting BullMQ concurrency to 0 or 100 on a CPU-intensive AI worker.
- Loading a 10MB PDF fully into a buffer instead of a stream, crashing the Node runtime.
- Forgetting connection pool limits in `src/db/index.js`, leading to Postgres exhaustion.
- Swallowing timeout errors instead of surfacing them to the metrics dashboard.

# Success criteria

The platform maintains low latency under high concurrent load.
Node.js memory usage remains flat over time without leaks.
Database queries execute via optimized join strategies.
System metrics accurately reflect the health of the application.
