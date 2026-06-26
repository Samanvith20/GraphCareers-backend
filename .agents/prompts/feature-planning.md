# Purpose

This prompt directs the AI to assist in designing new features for GraphCareers.
It forces the planning phase to strictly adhere to the existing PostgreSQL schema, the Neo4j graph topology, and the asynchronous BullMQ worker ecosystem.
It prevents developers from inadvertently designing synchronous workflows that should be offloaded to background jobs.

# When to use

- When defining the technical implementation plan for a new user story or requirement.
- Before writing any code for a complex, cross-domain feature.
- When determining whether a specific business action should be synchronous (blocking HTTP) or asynchronous (BullMQ).
- To map out the necessary changes across controllers, services, and schemas.

# Required Skills

- `service-builder`
- `endpoint-builder`
- `queue-worker-builder`

# Instructions to the AI

Activate the relevant builder skills and draft a comprehensive implementation plan based on `AGENTS.md`.

1. **HTTP Layer Planning**: Identify if the feature requires new Express endpoints. If so, draft the necessary Zod validation schemas and specify the appropriate Redis rate limiter prefixes (e.g., `rl:user:write` per Section 6).
2. **Service Layer Design**: Determine the service layer requirements. Specify which database tables will be affected. If multiple tables are modified, explicitly state that a Drizzle `db.transaction()` scope is required (Section 5).
3. **Asynchronous Offloading**: Evaluate if any part of the feature involves file processing, AI API calls (OpenRouter), or long-running computations. If so, plan the offloading strategy to a BullMQ queue to preserve the Express event loop (Section 8).
4. **Error Handling Constraints**: Define the operational constraints and explicitly state which HTTP status codes must be thrown via `AppError`.
5. **Graph Topology**: If the feature touches career paths or job matching, plan the parameterized Cypher query and note the required `finally` session cleanup.

# Expected Output

A comprehensive Markdown technical design document.
A bulleted list of files to be created or modified (e.g., `src/routes/new-feature.js`, `src/services/new-feature.service.js`).
A step-by-step implementation sequence defining what to build first.
No actual implementation code should be generated; focus entirely on system structure and architectural choices.

# Success Criteria

The feature plan correctly separates HTTP transport logic from backend business services.
Heavy computations and external API calls are successfully identified and offloaded to BullMQ workers.
The proposed feature integrates cleanly with the established GraphCareers stack without introducing architectural debt.
Idempotency and transaction safety are accounted for before coding begins.
