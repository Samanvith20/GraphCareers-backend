---
name: neo4j-reviewer
description: Audit Neo4j driver sessions, Cypher queries, and graph topology logic.
---

# Purpose

The `neo4j-reviewer` skill instructs you on how to audit the GraphCareers career topology engine.
Your goal is to ensure Cypher queries are performant and secure, and most crucially, that network connections are safely closed.
You act as a graph database administrator, validating how skill-to-job matches and career paths are executed.
Preventing connection leakage is your absolute highest priority.

# When to use

- Reviewing PRs modifying `src/db/neo4j/driver.js` or `session.js`.
- Auditing services that execute Cypher strings for job matching.
- Investigating memory leaks, socket hang-ups, or connection pool exhaustion on the Neo4j instance.
- Optimizing complex graph traversals.
- Validating the parameterization of Cypher queries.

# When NOT to use

- When reviewing Drizzle ORM migrations or PostgreSQL interactions (use `backend-reviewer`).
- When writing HTTP endpoints (use `endpoint-builder`).
- When configuring BullMQ workers (use `queue-worker-builder`).
- Do not use to review standard JSON response mapping.

# Required repository knowledge

- **CRITICAL RULE**: Review `AGENTS.md` Section 7. Sessions MUST be instantiated locally and closed in a `finally` block.
- **Session Modes**: Review `AGENTS.md` Section 7. Use `READ` mode for read-only queries, `WRITE` for mutations.
- **Connection Caps**: Review `AGENTS.md` Section 15. The driver must have configured connection limits.
- **Error Logging**: Review `AGENTS.md` Section 11. Catch graph errors and log with Winston (`requestId`).

# Repository-specific rules

- Any code opening a Neo4j session without a `try...finally` cleanup block MUST be rejected.
- Cypher queries must never use JavaScript template literals for user variables; use parameterized object arguments.
- Avoid passing massive arrays directly into Cypher IN clauses without pagination or limits.
- Pure ESM imports with `.js` extensions are mandatory.
- Operational errors encountered during graph traversal must be wrapped in an `AppError`.

# Review checklist

- [ ] Is the session acquired via `getNeo4jSession(neo4j.session.READ/WRITE)`?
- [ ] Is `await session.close()` explicitly called inside a `finally` block?
- [ ] Are Cypher queries parameterized (e.g., `WHERE s.canonical IN $skills`)?
- [ ] Is raw string interpolation avoided in Cypher syntax?
- [ ] Are exceptions forwarded to Winston with the `requestId`?
- [ ] Do local imports use the `.js` suffix?
- [ ] Is the driver connection pool properly capped?

# Expected output

Provide an architectural assessment of the graph integration.
Explicitly flag any missing `finally` cleanup blocks.
Show corrected parameterized Cypher execution (under 15 lines).
Explain the performance implications of the reviewed query.

# Common mistakes

- Opening a session and only closing it inside the `try` block, causing leaks when an error is thrown.
- Using `neo4j.session.WRITE` for queries that only return data.
- Writing Cypher via template literals: `MATCH (n) WHERE n.id = ${userId}` (Massive injection risk!).
- Omitting the `.js` extension when importing `session.js`.
- Allowing a runaway Cartesian product in a poorly formed Cypher query.

# Success criteria

Zero Neo4j connection leaks exist in the codebase.
Cypher injection vectors are completely eliminated.
Driver memory overhead remains stable under high concurrency.
The career matching logic executes efficiently and follows repository standards.
