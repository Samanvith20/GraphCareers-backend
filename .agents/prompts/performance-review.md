# Purpose

This prompt targets latency, resource efficiency, and computational bottlenecks within the GraphCareers platform.
It forces the AI to evaluate code through a systems engineering lens, focusing on connection pool exhaustion, memory limits, and database query efficiency.

# When to use

- When an endpoint's response time exceeds acceptable thresholds.
- When investigating high CPU utilization or out-of-memory errors in the Docker container.
- Before deploying complex new multi-table queries or Neo4j traversals.
- When configuring BullMQ worker concurrency for heavy tasks (e.g., AI integration).

# Required Skills

- `performance-reviewer`

# Instructions to the AI

Activate the `performance-reviewer` skill and audit the target code or module according to the performance guidelines in `AGENTS.md`.

1. **Relational Efficiency**: Analyze Drizzle ORM queries. Look for N+1 query patterns inside loops. Mandate refactoring via batch fetching or `.leftJoin()`.
2. **Connection Pools**: Verify that PostgreSQL (Drizzle) and Neo4j drivers respect connection pool limits (Section 15). Flag any rogue client instantiations.
3. **Graph Overhead**: Analyze Cypher queries. Ensure massive arrays are not passed into `IN` clauses without limits. Confirm `finally { await session.close() }` is present.
4. **Concurrency Limits**: Audit `src/workers/`. Verify that BullMQ worker concurrency is strictly capped to prevent Node.js event loop starvation.
5. **Volume Degradation**: Verify that workers processing resumes proactively `fs.unlink` the raw files to prevent the `/app/uploads` volume from running out of inodes.

# Expected Output

Produce a performance profiling report.
Quantify the bottleneck (e.g., "This loop will generate O(n) database queries").
Reference the specific `AGENTS.md` section being violated.
Output the optimized code alternative (max 15 lines), utilizing joins or batch strategies.
List any required configuration adjustments for connection caps.

# Success Criteria

The system event loop remains unblocked during heavy load.
Database queries are optimized to fetch required data in a single round-trip.
Memory leaks and connection drops are proactively identified and resolved.
Latency is measurably reduced.
