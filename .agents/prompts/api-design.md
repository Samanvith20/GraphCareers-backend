# Purpose

This prompt is utilized to structure and validate the outer boundary of the GraphCareers API.
It ensures that new API routes are mapped cleanly to RESTful principles, inputs are strictly sanitized via Zod, and HTTP responses are standard JSON.

# When to use

- When defining the contract between the frontend and the backend for a new feature.
- When creating or updating validation schemas in `src/schemas/`.
- When refactoring the routing layer to implement better rate limiting or middleware ordering.

# Required Skills

- `endpoint-builder`

# Instructions to the AI

Activate the `endpoint-builder` skill to design the API surface area according to `AGENTS.md`.

1. **Schema Definition**: Define a strict Zod schema for the expected payload. Ensure the schema strips unknown keys and enforces types.
2. **Middleware Pipeline**: Map the route utilizing the GraphCareers request lifecycle (Section 4). Ensure `authMiddleware` and Redis rate limiters are inserted before the validation step.
3. **Controller Structure**: Design the controller to safely extract parameters. Ensure it uses `try/catch` and strictly calls `next(err)` on failure.
4. **Context Injection**: Verify that the controller pulls `req.requestId` and passes it downward to the underlying service layer.

# Expected Output

Provide the implementation for the Zod schema, the Express route mapping, and the thin controller function.
Keep implementation snippets modular and concise (under 15 lines per segment).
Explain how the route hooks into the broader middleware pipeline.
Confirm that the error propagation mechanism matches the architectural standard.

# Success Criteria

The API strictly rejects malformed payloads before they reach business logic.
The HTTP layer remains entirely ignorant of database orchestration.
Errors are gracefully routed to the global error handler without hanging the request.
The implementation respects pure ESM module syntax.
