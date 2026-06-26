# Commit Message Template

Follow semantic versioning rules to categorize work correctly for changelogs.

```text
<type>(<scope>): <short description>

<optional detailed body explaining the architectural logic, Drizzle optimisations, or Neo4j updates>

Resolves: #<issue_number>
```

### Valid Types:
*   `feat`: Adding new API routes, services, or BullMQ workers.
*   `fix`: Resolving bugs, Neo4j connection leaks, or unhandled promise rejections.
*   `refactor`: Structural changes to align with the Controller-Service-Repository pattern.
*   `perf`: Eliminating N+1 Drizzle queries or adding database indexes.
*   `chore`: Updating dependencies, Docker configurations, or Prometheus metrics.
