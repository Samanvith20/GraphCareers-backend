# GraphCareers MCP Server Setup

This document defines the Model Context Protocol (MCP) server configuration required for the GraphCareers AI workspace. It establishes the least-privilege permissions, security boundaries, and engineering workflows for the AI.

**Security Principle:** All configurations must be environment-agnostic. The AI must rely exclusively on relative workspace paths (`./src/`) and Docker container paths (`/app`).

---

## 1. Filesystem MCP
*   **Purpose:** Enables the AI to scaffold code and navigate the repository.
*   **Required Permissions:** `Read/Write` scoped strictly to the current workspace root (`./`).
*   **Security Considerations:** Strict path isolation. The AI cannot traverse above the workspace root or access host OS configurations.
*   **Example Workflow:** Generating new Express endpoints and services utilizing the `.agents/templates/` boilerplates.

## 2. Docker MCP
*   **Purpose:** Enables the AI to inspect container health and logs.
*   **Required Permissions:** `Read-only` access to container status (`docker ps`) and logs (`docker logs`).
*   **Security Considerations:** No permission to stop/start containers, modify volumes, or access the Docker daemon socket directly. No arbitrary `docker exec` commands.
*   **Example Workflow:** Pulling `resume-worker` logs to investigate out-of-memory exceptions during AI extraction tasks.

## 3. PostgreSQL MCP
*   **Purpose:** Allows the AI to verify Drizzle ORM queries and inspect the relational schema.
*   **Required Permissions:** `GRANT SELECT` on application tables. Mutations (`INSERT`/`UPDATE`) restricted entirely to isolated development/test databases. No `DROP`, `ALTER`, or `TRUNCATE` permissions.
*   **Security Considerations:** Strict masking of Personally Identifiable Information (PII). AI is prohibited from executing automated schema migrations.
*   **Example Workflow:** Executing `EXPLAIN ANALYZE` to detect N+1 query patterns during the `performance-review.md` workflow.

## 4. Redis MCP
*   **Purpose:** Provides read access to inspect rate-limit counters and BullMQ job states.
*   **Required Permissions:** `READ` access to specific key prefixes (`GET`, `HGETALL`, `LRANGE`). No administrative commands (`FLUSHDB`, `KEYS *`).
*   **Security Considerations:** The AI must not have `WRITE` access to BullMQ keys to prevent the injection of unauthorized background jobs.
*   **Example Workflow:** Inspecting the `rl:user:write` counters to debug endpoint throttling logic.

## 5. Neo4j MCP
*   **Purpose:** Enables the AI to test and optimize Cypher queries against the career topology graph.
*   **Required Permissions:** `READ` traversal access (`neo4j.session.READ`). No `CREATE`, `SET`, or `DELETE` permissions on production clusters.
*   **Security Considerations:** Strict query execution timeouts must be enforced to prevent Cartesian products that could DoS the graph database.
*   **Example Workflow:** Validating parameterized skill-to-job matching Cypher queries before committing them to the service layer.

## 6. GitHub MCP
*   **Purpose:** Integrates the AI into the Pull Request review cycle.
*   **Required Permissions:** `Read` access to Repository/PRs. `Write` access restricted strictly to PR Comments. No admin or merge permissions.
*   **Security Considerations:** The MCP acts strictly as an advisory auditor and cannot approve its own code or force-merge PRs.
*   **Example Workflow:** Triggering the `code-review.md` prompt autonomously when a PR is opened to audit pure ESM (`.js`) compliance and Drizzle transaction usage.
