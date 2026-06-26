# Scaffold New Endpoint

**Description:** Use this prompt to safely generate a new API route, controller, and corresponding business service while enforcing the GraphCareers architecture.

**Prompt:**

```text
Please scaffold a new Express endpoint for the GraphCareers backend that handles: [Insert Feature Description here, e.g., 'updating a user's career roadmap preferences'].

Follow these strict steps:
1. Use the `endpoint-builder` skill to generate the Zod validation schema, the route definition, and the thin controller. Ensure the controller passes `req.requestId` to the service.
2. Use the `service-builder` skill to implement the core business logic. If this feature requires modifying multiple PostgreSQL tables, wrap the logic in a Drizzle `db.transaction()`.
3. If this is a state-mutating request, ensure the appropriate Redis rate limiting prefix (e.g., `rl:user:write`) is attached to the route.

Provide the completed code segments and explicitly explain how they fit into the Request Lifecycle pipeline.
```
