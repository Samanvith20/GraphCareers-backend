# Purpose

This prompt acts as an auditor for the GraphCareers career topology engine powered by Neo4j.
Its primary objective is to prevent catastrophic connection leaks by enforcing strict session lifecycle management and to optimize Cypher execution paths.

# When to use

- Reviewing any code inside `src/db/neo4j/` or services that interact with the graph database.
- Investigating connection pool exhaustion or socket hang-ups reported by the Neo4j container.
- Tuning the performance of a complex skill-to-job matching Cypher query.

# Required Skills

- `neo4j-reviewer`

# Instructions to the AI

Activate the `neo4j-reviewer` skill and rigorously inspect the target graph logic against `AGENTS.md`.

1. **CRITICAL LEAK CHECK**: Inspect every single instantiation of `getNeo4jSession()`. You MUST verify that an `await session.close()` exists explicitly within a `finally` block. Reject the code if this is missing (Section 7).
2. **Session Modality**: Verify that `neo4j.session.READ` is used for queries that only return data, and `WRITE` is used only for mutations.
3. **Cypher Injection**: Ensure that queries are strictly parameterized (e.g., using `$userSkills`) and never use JavaScript template literals to inject user variables directly into the Cypher string.
4. **Error Traceability**: Ensure that when a Cypher query fails, the error is logged via Winston using the `requestId` to maintain distributed traceability.

# Expected Output

Provide a definitive pass/fail regarding session lifecycle safety.
Output the exact line numbers where sessions might be dangling.
Provide a corrected snippet (max 15 lines) demonstrating the `try { ... } finally { await session.close(); }` pattern.
Flag any injection vulnerabilities found in the Cypher construction.

# Success Criteria

Zero Neo4j connection leaks exist in the reviewed code.
All queries are perfectly parameterized to prevent injection.
Driver memory overhead remains stable under high concurrency.
The graph operations adhere to the GraphCareers pure ESM standards.
