# Purpose

This prompt triggers a holistic architectural review of the GraphCareers backend.
It validates system boundaries, data flow across the Express-Service-Database layers, and ensures that newly proposed patterns align with the core philosophy defined in the repository.
It ensures that business logic remains completely decoupled from HTTP transport concerns, protecting the codebase from tight coupling and degradation over time.

# When to use

- Before merging large-scale refactors spanning multiple directories (e.g., separating monolithic endpoints).
- When proposing a new microservice or background worker pattern to ensure it fits the existing ecosystem.
- During cross-team synchronization to validate system design compliance against established architectural decisions.
- Whenever auditing the codebase for structural integrity and modularity.

# Required Skills

- `backend-reviewer`
- `security-reviewer`
- `performance-reviewer`

# Instructions to the AI

Activate the required skills and rigorously evaluate the target code against `AGENTS.md`.

1. **Request Lifecycle Compliance**: Validate the pipeline specified in Section 4. Ensure controllers remain thin, handle parameter extraction, orchestrate Zod validation, and delegate to services.
2. **ESM Constraints**: Verify adherence to Section 10. Ensure all internal modules explicitly use the `.js` extension. Reject imports lacking extensions.
3. **Database Patterns**: Validate Section 5 and Section 7. Look for the correct usage of `db.transaction()` for Drizzle ORM modifications and the mandatory `finally` blocks for closing Neo4j sessions.
4. **Error Propagation**: Assess the exception handling strategy. Ensure that instances of `AppError` bubble up via `next(err)` in controllers and are never swallowed silently by generic catch blocks.
5. **Context Traceability**: Ensure that `req.requestId` is consistently passed from the Express router down into the Winston logger proxy across all layers.

# Expected Output

Provide a structured architectural assessment using Markdown.
Output a compliance matrix scoring the code against the GraphCareers rules.
Highlight any bleeding of concerns between the Express routing layer and the business logic services.
Provide exact file paths where architectural leaks occur.
Suggest structural refactors using brief snippets (max 15 lines).

# Success Criteria

The review successfully identifies architectural leaks and anti-patterns.
All feedback strictly references internal repository documentation rather than generic industry standards.
The engineer receives highly actionable steps to align their code with the repository's Controller-Service-Repository standard.
The end state of the codebase is more decoupled and resilient.
