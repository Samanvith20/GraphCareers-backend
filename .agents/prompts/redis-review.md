# Purpose

This prompt audits the integration of Redis within the GraphCareers infrastructure.
It enforces the strict boundary that Redis is solely a tool for rate limiting and job persistence, preventing developers from mistakenly utilizing it as a generic application cache.

# When to use

- When a developer proposes adding cache logic to an endpoint.
- When debugging `ioredis` connection drops, timeouts, or pool exhaustion.
- When reviewing updates to rate limiter configurations in `src/middleware/rateLimiters/`.

# Required Skills

- `redis-reviewer`

# Instructions to the AI

Activate the `redis-reviewer` skill and strictly audit the code against the Redis guidelines in `AGENTS.md`.

1. **Architectural Enforcement**: Scan the code for any attempt to store application state (e.g., user profiles, query results) in Redis. Reject these immediately (Section 6).
2. **Rate Limiting Setup**: Verify that the correct Redis rate limiting prefixes are applied (e.g., `rl:user:write`). Ensure the middleware is correctly invoking `next(err)` upon exhaustion.
3. **Connection Pooling**: Verify that all modules (including BullMQ) are utilizing the singleton connection exported from `src/config/redis.js` rather than instantiating rogue `new Redis()` clients.
4. **Resilience**: Check that network partitioning between Node and Redis does not crash the server unconditionally, and that errors are logged via Winston.

# Expected Output

Output a critical assessment of the Redis usage.
Highlight any violations of the caching constraints outlined in Section 6.
Provide refactored logic for connection sharing or rate limiter setup (max 15 lines).
Assess the stability of the Redis connection pool under the proposed changes.

# Success Criteria

Redis is utilized exclusively for Rate Limiting and BullMQ.
No application state is stored locally or temporarily in cache.
The connection pool remains stable without rogue instantiations.
Write endpoints are robustly protected against brute-force abuse.
