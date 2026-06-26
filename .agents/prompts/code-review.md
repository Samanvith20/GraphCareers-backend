# Purpose

This prompt acts as a rapid Pull Request (PR) review macro.
It directs the AI to scan code diffs strictly against the GraphCareers ruleset, ignoring generic stylistic preferences in favor of hard architectural mandates.
It ensures no regressions are introduced into the main branch.

# When to use

- Automatically scanning incoming code changes before merging.
- Reviewing a teammate's PR for architectural compliance.
- Performing a self-review of uncommitted changes before pushing.
- Validating that error handling and request lifecycles remain uncompromised.

# Required Skills

- `backend-reviewer`

# Instructions to the AI

Activate the `backend-reviewer` skill and execute a strict line-by-line code review based on `AGENTS.md`.

1. **Imports Check**: Scan all new or modified `import` statements. Reject any local import that is missing the `.js` extension (Section 10).
2. **Logger Verification**: Scan for `console.log` or `console.error`. Flag them as violations and mandate the use of the Winston proxy logger with `requestId` (Section 11).
3. **Controller Integrity**: Ensure no database queries (Drizzle or Cypher) exist in the controller layer. Verify `next(err)` is used for all caught exceptions (Section 12).
4. **Transaction Safety**: Flag any sequential `db.insert()` or `db.update()` calls that modify multiple tables without a wrapping `db.transaction()` (Section 5).
5. **Idempotency**: Flag inserts on unique tables that lack `.onConflictDoUpdate()`.

# Expected Output

Provide a structured, checklist-style review matrix.
List out all detected violations of `AGENTS.md`, categorized by severity.
Include line-specific feedback for the diff.
Output corrected code snippets (max 15 lines) showing how to refactor the flagged code to meet GraphCareers standards.
Conclude with a binary "Pass/Fail" assessment.

# Success Criteria

The review catches all ESM import errors before they crash the Node container.
The review prevents business logic from leaking into the Express routing layer.
All errors are properly routed to Sentry via the global handler.
The feedback is entirely repository-specific and highly actionable.
