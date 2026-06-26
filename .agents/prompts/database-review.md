# Purpose

This prompt focuses on auditing relational database interactions utilizing Drizzle ORM within PostgreSQL.
It ensures atomicity, idempotency, and query efficiency, safeguarding the GraphCareers data layer from corruption or race conditions.

# When to use

- Reviewing complex multi-table inserts or updates in `src/services/`.
- Validating the implementation of a new database schema migration.
- Investigating duplicate record bugs or partial data writes.

# Required Skills

- `backend-reviewer`

# Instructions to the AI

Activate the `backend-reviewer` skill and inspect the relational database code against the GraphCareers core documentation (`AGENTS.md`).

1. **Transactional Atomicity**: Scan for sequential `.insert()` or `.update()` calls. If multiple tables are modified, mandate the use of `db.transaction(async (tx) => { ... })` (Section 5).
2. **Idempotency Enforcement**: Ensure that upserts on tables with unique constraints utilize `.onConflictDoUpdate()`. Reject patterns that rely on "check if exists, then insert" to avoid race conditions.
3. **Query Safety**: Verify that raw SQL interpolation is never used. All queries must utilize Drizzle's typed syntax.
4. **Error Wrapping**: If a database constraint fails, ensure the code throws an `AppError` rather than crashing the process or swallowing the fault.

# Expected Output

Provide a data integrity report.
Identify any missing transaction blocks that could lead to half-flushed states.
Output refactored snippets (max 15 lines) showing how to properly chain `.onConflictDoUpdate()` or wrap queries in a `tx` object.
Confirm that no raw SQL strings exist.

# Success Criteria

Database writes are guaranteed to be atomic and race-condition free.
The system maintains strict referential integrity.
All code utilizes proper pure ESM imports (`.js`).
The database pool is not overwhelmed by N+1 query patterns.
