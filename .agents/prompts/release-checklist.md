# Purpose

This prompt acts as the ultimate gatekeeper macro before code is deployed to the production environment.
It synthesizes multiple review dimensions—architecture, performance, and security—into a final compliance check.

# When to use

- Prior to merging a release branch into main.
- When conducting a final audit of a major feature deployment.
- As a holistic system check to ensure no debugging artifacts or configuration errors were left behind.

# Required Skills

- `backend-reviewer`
- `performance-reviewer`
- `security-reviewer`

# Instructions to the AI

Activate the required skills and perform a comprehensive sweep of the target code against `AGENTS.md`.

1. **Security & Perimeter**: Validate that CORS remains strictly bound, payload limits are intact, and rate limiters are applied to all mutating routes (Section 6, 14).
2. **Database & Connection Safety**: Ensure PostgreSQL connection pools are capped (Section 15), Drizzle transactions are used for multi-writes (Section 5), and absolutely no Neo4j sessions are missing a `finally { await session.close(); }` block (Section 7).
3. **Architectural Purity**: Confirm no business logic exists in controllers. Ensure all asynchronous functions propagate errors via `next(err)`.
4. **Observability**: Verify that `console.log` is absent, Winston is utilized with `requestId`, and worker failures are hooked into Sentry.
5. **ESM Compliance**: Perform a final check that all internal module imports possess the `.js` extension.

# Expected Output

Provide a final deployment readiness report.
Output a strict checklist confirming compliance across Security, Performance, and Architecture.
If any violation is found, output a red flag with the exact file path and a highly concise snippet (max 15 lines) to fix the blocking issue.
Conclude with a definitive "Approved for Release" or "Block Release" status.

# Success Criteria

The codebase is certified as production-ready.
No performance leaks or security vulnerabilities bypass the review.
The application perfectly adheres to the Controller-Service-Repository pattern.
The release can be merged with total confidence.
