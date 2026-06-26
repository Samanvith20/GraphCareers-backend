# Audit Architecture & Security

**Description:** Use this prompt to trigger a comprehensive code review of uncommitted changes or a specific directory to ensure compliance with our core patterns.

**Prompt:**

```text
Please perform a rigorous code review of [Insert Target Directory/Files or 'my uncommitted changes']. 

I want you to invoke both the `backend-reviewer` and `security-reviewer` skills:
1. Verify that the Controller-Service-Repository pattern is intact (business logic must not exist in controllers).
2. Check that all controllers utilize `try/catch` blocks and forward exceptions to `next(err)`.
3. Ensure no raw SQL interpolation is occurring with Drizzle ORM.
4. Confirm that pure ESM imports (with `.js` extensions) are used universally.
5. If any route handlers were modified, verify that Zod validation and `authMiddleware` (where applicable) are correctly placed in the Express pipeline.

Output a checklist of violations and provide refactored snippets (under 15 lines) for any failed checks.
```
