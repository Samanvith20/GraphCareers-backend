---
name: endpoint-builder
description: Construct Express routes, Zod schemas, and thin controllers for GraphCareers.
---

# Purpose

The `endpoint-builder` skill defines how the AI constructs the outer boundary of the GraphCareers API.
Your goal is to build thin, secure Express controllers that bridge the HTTP protocol to our inner service layer.
You must think in terms of the Request Lifecycle: validation, rate limiting, and safe error propagation.
You act as a traffic director—extracting HTTP payloads, running them through Zod, calling a service, and mapping the output back to JSON.

# When to use

- Creating a new route mapping in `src/routes/`.
- Generating a new validation definition in `src/schemas/` using Zod.
- Writing a new HTTP handler in `src/controllers/`.
- Adding auth or rate-limit middleware to existing endpoints.
- Updating JSON response payloads for the frontend.
- When you need to parse `req.body`, `req.params`, or `req.query` securely.

# When NOT to use

- When defining complex transactional data rules (use `service-builder`).
- When writing BullMQ processors (use `queue-worker-builder`).
- When analyzing Neo4j query performance (use `neo4j-reviewer`).
- When setting up the global Express instance in `index.js`.
- Do not use for anything that doesn't involve `req`, `res`, and `next`.

# Required repository knowledge

- **Request Lifecycle**: Review `AGENTS.md` Section 4. Understand that requests hit CORS, Auth, and RateLimit before the controller.
- **Validation**: Review `AGENTS.md` Section 10. Zod parsing is mandatory for all inputs.
- **Error Handling**: Review `AGENTS.md` Section 12. Controllers cannot swallow errors. They must use `next(err)`.
- **Rate Limiting**: Review `AGENTS.md` Section 6. Write operations must use Redis rate limiting (e.g., `rl:user:write`).

# Repository-specific rules

- Never pass `req` or `res` to the service layer. Extract values and pass them explicitly.
- Every asynchronous controller must use a `try { ... } catch (err) { next(err); }` block.
- Do not execute database queries (Drizzle or Neo4j) directly in the controller.
- Always retrieve `req.requestId` and pass it to services or Winston logs for tracing.
- Validate inputs using Zod middleware before the controller executes.

# Review checklist

- [ ] Is the controller wrapped in a try/catch block with `next(err)`?
- [ ] Are inputs validated using Zod?
- [ ] Is the database completely decoupled from this file?
- [ ] Are `.js` extensions present on all local imports?
- [ ] Is the appropriate rate limiter applied to write/upload routes?
- [ ] Is `req.requestId` captured and utilized?
- [ ] Are success responses returned as standard JSON?

# Expected output

Provide a concise implementation of the Zod schema, the controller function, and the route mapping.
Keep implementation examples short (under 15 lines per file segment).
Explain how the route hooks into the broader middleware pipeline.
Confirm that the error propagation matches `AGENTS.md`.

# Common mistakes

- Writing `db.query(...)` directly inside `auth.controller.js`.
- Forgetting to invoke `next(err)` in the catch block, causing requests to hang indefinitely.
- Omitting `.js` on imports.
- Reading `req.body` directly without validating it against a Zod schema.
- Applying a heavy service operation without checking the `authMiddleware` first.
- Failing to return a clean JSON response upon success.

# Success criteria

The endpoint safely validates all incoming data.
Errors are gracefully routed to the global handler and Sentry.
The controller remains a thin wrapper around a robust service.
The routing structure strictly conforms to GraphCareers standards.
