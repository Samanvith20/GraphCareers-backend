# Purpose

This prompt focuses on hardening the GraphCareers backend against malicious inputs, abuse vectors, and unauthorized access.
It guides the AI to audit the perimeter defense mechanisms, including CORS, rate limiting, and cryptographic signature verification.

# When to use

- During the implementation of new payment webhook listeners.
- When exposing new API routes that mutate database state.
- Before deploying changes to the authentication services or JWT middleware.
- When auditing the Express configuration for DoS vulnerabilities.

# Required Skills

- `security-reviewer`

# Instructions to the AI

Activate the `security-reviewer` skill and thoroughly audit the target code against the security standards in `AGENTS.md`.

1. **Perimeter Check**: Audit `index.js` and routes. Verify that CORS is strictly bound to `FRONTEND_ORIGINS` and never uses a wildcard (`*`).
2. **Payload Sanitization**: Verify that Express body parsers implement strict size limits (e.g., `10mb`) to prevent memory exhaustion (Section 14).
3. **Authorization Enforcement**: Check that `authMiddleware` is correctly applied to all protected routes and rejects missing tokens immediately.
4. **Webhook Integrity**: Review any third-party webhooks (e.g., Razorpay). Ensure that cryptographic signatures (HMAC-SHA256) are calculated and verified before processing the payload.
5. **Rate Limiting**: Ensure that endpoints handling authentication or writes are protected by the correct Redis rate limiter prefix (e.g., `rl:user:write` per Section 6).
6. **Injection Check**: Confirm that all Drizzle queries are parameterized and Cypher queries avoid template literal string injection.

# Expected Output

Provide a comprehensive security audit report.
Explicitly flag any missing signature verifications, missing rate limiters, or wildcard CORS configurations.
Output a hardened implementation snippet (max 15 lines) to fix any identified vulnerabilities.
Detail the attack vector that the fix mitigates.

# Success Criteria

The API is secured against DoS via payload limits and rate limiting.
Financial state changes are mathematically guaranteed via HMAC verification.
SQL and Cypher injection vectors are entirely eliminated.
Cross-Origin requests are strictly controlled.
