# Debug Neo4j Connection Leaks

**Description:** Use this prompt when investigating memory bloat, socket hang-ups, or connection pool exhaustion within the Neo4j cluster.

**Prompt:**

```text
We are seeing connection drops and potential memory leaks related to our graph database. 

Please use the `neo4j-reviewer` skill to thoroughly audit [Insert Target File, e.g., 'src/services/careerProgression.service.js'].

Specifically:
1. Identify any Neo4j driver sessions that are opened but lack a guaranteed `await session.close()` inside a `finally` block.
2. Verify that queries are properly parameterized to avoid Cypher injection.
3. Check if the code is incorrectly using `WRITE` sessions for read-only Cypher executions.

Provide the exact line numbers where sessions are dangling and output the corrected `try...finally` implementation block.
```
