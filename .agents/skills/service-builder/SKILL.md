---
name: service-builder
description: Construct business logic and transactional database services for GraphCareers.
---

# Purpose

The `service-builder` skill dictates how AI thinks about GraphCareers' central nervous system: the service layer.
Your goal is to implement reusable, context-agnostic business logic in `src/services/`.
You must act as a translator between raw data inputs and backend database state (PostgreSQL via Drizzle, Neo4j).
Services should be entirely decoupled from the Express transport layer, allowing them to be invoked by HTTP controllers, background workers, or cron jobs alike.

# When to use

- Generating new files inside `src/services/`.
- Encapsulating complex database orchestration involving Drizzle ORM.
- Implementing cross-table interactions that require atomic `db.transaction()` blocks.
- Offloading heavy controller logic into a reusable service module.
- Connecting third-party APIs (e.g., Razorpay, OpenRouter) to the core application state.
- Refactoring monolithic functions into smaller, testable business actions.

# When NOT to use

- When defining Express routes or validating raw HTTP bodies (use `endpoint-builder`).
- When writing asynchronous BullMQ processors (use `queue-worker-builder`).
- When auditing purely graph-related issues (use `neo4j-reviewer`).
- When you are simply auditing the codebase rather than writing new logic.
- Do not use for frontend integration.

# Required repository knowledge

- **Database Architecture**: Review `AGENTS.md` Section 5. Drizzle ORM is used for relational state, and `db.transaction()` is required for multi-update atomicity.
- **Error Conventions**: Review `AGENTS.md` Section 12. Services MUST throw `AppError` for operational faults (e.g., "Insufficient credits").
- **Pure ESM**: Review `AGENTS.md` Section 10. Imports must have `.js` extensions.
- **Neo4j Constraints**: Review `AGENTS.md` Section 7. If accessing the graph, local sessions must close in a `finally` block.

# Repository-specific rules

- Services must never receive `req` or `res` objects. Pass explicit parameters instead.
- Services must enforce data idempotency. Use Drizzle's `onConflictDoUpdate` when inserting entities like resumes or users.
- When an operation violates a business constraint, throw `AppError(message, statusCode)`. Do not return null or error objects.
- Log critical milestones using Winston, passing the `requestId` from the caller.

# Review checklist

- [ ] Does the service accept pure data (no `req`/`res`)?
- [ ] Are multi-table writes wrapped in `db.transaction(async (tx) => { ... })`?
- [ ] Do local file imports contain `.js`?
- [ ] Are operational failures throwing `AppError`?
- [ ] Does the service forward the `requestId` to Winston for logging?
- [ ] Are third-party integrations cleanly separated from internal logic?
- [ ] Are Neo4j sessions closed via `finally` if graph queries are executed?

# Expected output

Output fully functional Node.js ESM code to be placed in `src/services/`.
Briefly explain the rationale behind the transaction boundaries.
Provide snippets (max 15 lines) of how a controller or worker would invoke this service.
Ensure all exported functions are documented and async.

# Common mistakes

- Writing `export const myService = (req, res) => {}` instead of `export const myService = async (userId, data) => {}`.
- Forgetting `.js` in `import { schema } from '../db/schema'`.
- Running multiple `db.insert()` calls outside of a `db.transaction()` block.
- Catching an error, logging it, and returning `false` instead of letting the error bubble up to the controller's `next(err)`.
- Utilizing `console.log` instead of the Winston logger.

# Success criteria

The generated service is transport-agnostic and fully testable.
Database state remains consistent even if failures occur mid-execution.
Business rules are rigorously enforced via `AppError`.
Code conforms entirely to GraphCareers ESM and logger conventions.
