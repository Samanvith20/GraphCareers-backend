---
name: security-reviewer
description: Audit GraphCareers for vulnerabilities, input validation, and auth flaws.
---

# Purpose

The `security-reviewer` skill teaches you how to harden the GraphCareers backend perimeter.
Your focus is to prevent unauthorized access, payload abuse, cross-site attacks, and injection flaws.
You act as the defensive shield, interrogating Express middleware, Zod schemas, CORS configurations, and webhook verifications.
You must ensure that security mechanisms are never bypassed in favor of quick feature delivery.

# When to use

- Reviewing modifications to `auth.controller.js`, `auth.service.js`, or `authMiddleware.js`.
- Auditing the global CORS setup in `index.js`.
- Verifying the HMAC-SHA256 signature logic for third-party webhooks (e.g., Razorpay).
- Validating payload size limits on upload endpoints.
- Checking for SQL injection vulnerabilities in Drizzle usage.
- Reviewing rate-limiting abuse protection.

# When NOT to use

- When optimizing graph traversal algorithms (use `neo4j-reviewer`).
- When writing generic background tasks (use `queue-worker-builder`).
- When implementing a basic database schema change without security implications.
- Do not use for frontend DOM manipulation or UI security.

# Required repository knowledge

- **CORS & Payloads**: Review `AGENTS.md` Section 14. Origins must be strictly bound. Body parser limits (e.g., `10mb`) are required.
- **Access Control**: Review `AGENTS.md` Section 14. `authMiddleware` must reject missing tokens immediately.
- **Signature Checking**: Review `AGENTS.md` Section 14. Webhooks must explicitly verify HMAC signatures.
- **Injection Protection**: Review `AGENTS.md` Section 14. Drizzle ORM syntax must be used exclusively; no raw SQL strings.
- **Rate Limiting**: Review `AGENTS.md` Section 6. Protection prefixes are mandatory for state-mutating endpoints.

# Repository-specific rules

- Never use wildcard (`*`) CORS origins. Use the `FRONTEND_ORIGINS` environment variable.
- Any webhook handler (e.g., `/api/payments/webhook`) must execute signature verification before touching the database.
- Zod validation is non-negotiable for all incoming payloads.
- Secrets and API keys must never be hardcoded; verify they are pulled from environment variables.
- Pure ESM imports (`.js`) must be maintained across all security utility files.

# Review checklist

- [ ] Is CORS configured to reject unknown domains?
- [ ] Are Express body parsers capped at a safe memory limit?
- [ ] Does the route use `authMiddleware` if it handles sensitive data?
- [ ] Are third-party webhooks cryptographically verified?
- [ ] Is raw SQL interpolation avoided completely?
- [ ] Are rate limiters applied to authentication routes to prevent brute-forcing?
- [ ] Are local file imports using the `.js` extension?

# Expected output

Provide a detailed security audit report in markdown.
Reference specific section violations in `AGENTS.md` (e.g., Section 14).
Output a hardened implementation example (under 15 lines).
Highlight the exact attack vector if a vulnerability is found.

# Common mistakes

- Using `cors()` without an options object, allowing all domains to access the API.
- Reading `req.body` in a webhook before verifying the header signature.
- Using `sql\`...${userInput}...\`` in Drizzle queries instead of parameterized values.
- Forgetting to attach `authMiddleware` to a newly created API route.
- Failing to validate object structures with Zod, trusting client data blindly.

# Success criteria

The API perimeter is impenetrable to common OWASP threats.
Payloads cannot exhaust server memory.
Financial state changes are cryptographically guaranteed.
All security code conforms to GraphCareers strict ESM and architecture rules.
