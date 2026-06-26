---
name: backend-reviewer
description: Review code changes across GraphCareers backend layers (controllers, services, workers, db).
---

# Purpose

The `backend-reviewer` skill empowers you to audit cross-layer modifications in the GraphCareers architecture.
Your goal is to enforce the strict separation of concerns outlined in `AGENTS.md` (e.g., Controller-Service-Repository pattern).
You must evaluate how data flows from HTTP requests down to PostgreSQL/Neo4j and ensure that business logic never bleeds into routing.
By acting as the gatekeeper, you maintain system integrity.

# When to use

- Reviewing a Pull Request that spans multiple directories (e.g., `src/controllers`, `src/services`, `src/db`).
- Auditing the end-to-end request lifecycle for compliance.
- Validating global error handling and middleware execution order.
- Checking codebase refactoring efforts for architectural consistency.
- Whenever a user asks "Is this code following our backend standards?"
- Reviewing cross-service dependencies to ensure no circular references exist.

# When NOT to use

- When focusing exclusively on Neo4j queries (use `neo4j-reviewer`).
- When setting up Redis rate limiting (use `redis-reviewer`).
- When writing a single endpoint from scratch (use `endpoint-builder`).
- When building a new background worker (use `queue-worker-builder`).
- Do not use for frontend code or infrastructure provisioning.
- Do not use for performance profiling (use `performance-reviewer`).

# Required repository knowledge

- **Request Lifecycle**: Review `AGENTS.md` Section 4. You must know the exact pipeline: CORS -> ReqID -> Metrics -> Auth -> RateLimit -> Zod -> Controller -> Service -> DB.
- **Error Routing**: Review `AGENTS.md` Section 12. Errors must be instances of `AppError` and propagated via `next(err)`.
- **Module System**: Review `AGENTS.md` Section 10. We use pure ESM; all imports require `.js` extensions.
- **Transactions**: Review `AGENTS.md` Section 5. Drizzle transactions are mandatory for multi-table updates.

# Repository-specific rules

- Controllers must only extract parameters, call Zod validators, and delegate to services. They cannot contain SQL or Cypher.
- Services must remain ignorant of HTTP context (`req`, `res`). They throw `AppError` on business rule violations.
- All application logs must use Winston and pass `{ requestId: req.requestId }` as metadata. `console.log` is strictly prohibited.
- Multi-table database mutations must be wrapped in `db.transaction()` via Drizzle.
- Idempotency is required for entity creation using `.onConflictDoUpdate()`.

# Review checklist

- [ ] Does the import path end with `.js`?
- [ ] Is `console.log` completely absent?
- [ ] Does the controller use `try/catch` and forward errors to `next(err)`?
- [ ] Are business rules encapsulated entirely within the `src/services/` layer?
- [ ] Is `AppError` used for operational exceptions with appropriate HTTP status codes?
- [ ] Do database insertions use `.onConflictDoUpdate()` where idempotency is required?
- [ ] Does the Winston log pass the `requestId` context object?
- [ ] Are all database pools properly utilized without instantiating rogue connections?

# Expected output

Provide a clear, structured review using markdown.
Highlight violations of `AGENTS.md` by referencing the specific section number.
Output code snippets showing the corrected implementation (under 15 lines).
Conclude with a definitive pass/fail assessment.
Summarize the impact of the changes on the overall architecture.

# Common mistakes

- Missing `.js` extensions on local imports (e.g., `import { db } from "../db/index"`).
- Catching an error in a controller and responding with `res.status(500)` instead of `next(err)`.
- Putting database query logic directly inside `src/controllers/`.
- Creating `new Error()` instead of throwing `new AppError("msg", 400)`.
- Failing to pass the transaction object `tx` into nested Drizzle queries.
- Ignoring the request pipeline order by placing validation after controller execution.

# Success criteria

A successful review correctly identifies architectural leaks.
It enforces pure ESM compliance seamlessly.
It catches swallowed errors before they enter production.
It guides the user toward the Controller-Service-Repository pattern defined in the repository.
