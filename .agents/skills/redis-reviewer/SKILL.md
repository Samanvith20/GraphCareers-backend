---
name: redis-reviewer
description: Audit Redis rate limiters, BullMQ persistence, and connection pools in GraphCareers.
---

# Purpose

The `redis-reviewer` skill trains you to audit GraphCareers' caching and queuing infrastructure.
Your objective is to ensure that Redis is used exclusively for its intended architectural purposes: Rate Limiting and BullMQ persistence.
You must prevent the introduction of local cache state and ensure connection pools are resilient.
You act as a reliability engineer, validating that Redis drops do not crash the primary Node container unconditionally.

# When to use

- Reviewing changes to the core Redis client in `src/config/redis.js`.
- Auditing the configuration of `rate-limiter-flexible` inside `src/middleware/`.
- Validating the application of rate limiting prefixes to specific endpoints.
- Investigating `ioredis` timeout or connection limit exceptions.
- Ensuring BullMQ queues share the singleton Redis connection.

# When NOT to use

- When reviewing Drizzle ORM or PostgreSQL performance (use `performance-reviewer`).
- When writing a worker's execution logic (use `queue-worker-builder`).
- When building a new HTTP controller (use `endpoint-builder`).
- Do not use for generic cache optimization techniques since we do not cache application state in Redis.

# Required repository knowledge

- **Redis Usage Limits**: Review `AGENTS.md` Section 6. Redis is ONLY for rate limiting and BullMQ. No application state caching.
- **Rate Limiters**: Review `AGENTS.md` Section 6. Prefixes like `rl:user:write` and `rl:user:resume-upload` are mandatory.
- **Client Management**: Review `AGENTS.md` Section 6. The connection is pooled in `src/config/redis.js`.
- **Pure ESM**: Review `AGENTS.md` Section 10. Imports must have `.js` extensions.

# Repository-specific rules

- Any attempt to use Redis to cache user profiles or database queries must be rejected.
- Rate limiters must be explicitly attached as middleware to Express routes.
- The Redis client must implement health checks for deployment readiness probes.
- BullMQ configurations must reuse the exported Redis connection rather than creating their own.
- Connection failures should be logged via Winston (`logger.error`) but shouldn't necessarily halt the entire application loop.

# Review checklist

- [ ] Does the code attempt to cache standard application data in Redis? (Must fail if yes).
- [ ] Are rate limit prefixes correctly mapped (e.g., `rl:user:write`)?
- [ ] Is the singleton Redis instance imported correctly with `.js`?
- [ ] Does the rate limiter middleware properly invoke `next(err)` on failure?
- [ ] Is the Redis client configured with backoff and retry strategies?
- [ ] Are BullMQ instances pointing to the shared Redis client?

# Expected output

Output a critical assessment of the Redis integration.
Highlight any violations of Section 6 from `AGENTS.md`.
Provide refactored connection or limiter logic (under 15 lines).
Assess the impact of the changes on the shared connection pool.

# Common mistakes

- Doing `import Redis from 'ioredis'` inside a service and instantiating `new Redis()`.
- Caching database query results in Redis, violating the stateless design.
- Creating a rate limiter but forgetting to inject it into the Express route pipeline.
- Omitting `.js` on imports.
- Allowing BullMQ to aggressively poll without respecting infrastructure limits.

# Success criteria

The Redis implementation is highly available and pooled correctly.
No application state is accidentally cached.
Write endpoints are fully protected against brute-force abuse.
The codebase adheres to pure ESM standards.
