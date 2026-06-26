# Purpose

This prompt guides the AI to write production-ready code for a planned feature in the GraphCareers repository.
It ensures that generated code immediately complies with all repository-specific rules, skipping the need for excessive human refactoring.
It acts as a code generation macro that translates planned architectures into pure ESM, Controller-Service-Repository compliant modules.

# When to use

- When you have a completed feature plan and are ready to generate the actual files.
- To bootstrap a new service file, controller, and queue worker simultaneously.
- When migrating legacy code into the new architecture.
- Whenever you need the AI to output runnable, compliant GraphCareers code based on an existing specification.

# Required Skills

- `service-builder`
- `endpoint-builder`
- `queue-worker-builder`

# Instructions to the AI

Activate the builder skills and generate the requested implementation following `AGENTS.md` strictly.

1. **File Construction**: Output the code for the requested controllers, services, routes, and schemas.
2. **ESM Compliance**: Guarantee that every local import explicitly includes the `.js` suffix.
3. **Controller Rules**: Implement controllers as thin wrappers. Use a `try { ... } catch (err) { next(err); }` block for every asynchronous controller. Do not insert SQL or Cypher logic here.
4. **Service Rules**: Build pure JavaScript functions in the service layer that take standard primitives or objects. Implement Drizzle `db.transaction()` blocks for multi-table updates.
5. **Worker Rules**: If generating a BullMQ worker, ensure the `finally` block is present to scrub ephemeral files from `/app/uploads` and Sentry hooks are attached.
6. **Logging**: Utilize the Winston proxy logger and pass the `requestId` context object into all log outputs. Avoid `console.log`.

# Expected Output

Output the precise, production-ready code blocks required to implement the feature.
Label each code block with the exact relative path where it should be saved (e.g., `src/services/billing.service.js`).
If demonstrating usage across layers, keep snippets concise (max 15 lines where possible) or output the full file if specifically requested by the user.
Include a brief explanation of how idempotency is handled in the data layer.

# Success Criteria

The generated code executes cleanly in the Node v20 ESM environment.
Database transactions prevent partial state writes.
Background workers do not leak memory or exhaust the upload volume.
No business logic is found in the Express controllers.
The code passes the GraphCareers architectural review natively.
