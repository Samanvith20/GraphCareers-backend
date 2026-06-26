# Optimize PostgreSQL Queries

**Description:** Use this prompt to trigger a systems-level review of database performance and resource efficiency.

**Prompt:**

```text
I need to optimize the database interactions in [Insert Target File, e.g., 'src/services/jobs.service.js'].

Please invoke the `performance-reviewer` skill to analyze the Drizzle ORM queries:
1. Identify any N+1 query patterns (e.g., iterating over an array to execute multiple queries) and refactor them using `.leftJoin()` or batching.
2. Check if large datasets are being loaded entirely into memory synchronously.
3. Ensure that Drizzle transactions (`db.transaction`) are not being held open unnecessarily for slow, non-database operations.

Provide a quantified assessment of the bottleneck and output the optimized code alternative.
```
