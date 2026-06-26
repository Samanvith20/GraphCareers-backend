# Pull Request Template

```markdown
## Description
<!-- Provide a brief overview of the architectural changes and business logic. Link to any relevant issue numbers. -->

## Architecture Checklist (GraphCareers)
- [ ] Import paths exclusively use the `.js` extension (Pure ESM).
- [ ] Express controllers contain NO business logic or direct database queries.
- [ ] Asynchronous controllers wrap operations in `try/catch` and forward exceptions to `next(err)`.
- [ ] Winston logger is used instead of `console.log`, propagating `req.requestId`.
- [ ] Drizzle ORM mutations on multiple tables are wrapped inside a `db.transaction()`.
- [ ] Neo4j sessions are rigorously closed using a `finally { await session.close(); }` block.
- [ ] BullMQ workers contain `finally` blocks to scrub ephemeral files from `/app/uploads`.

## Security & Performance
- [ ] Zod validation schemas are applied to all modified or new routes.
- [ ] Redis rate limiters (`rl:user:write` etc.) are applied to state-mutating endpoints.
- [ ] Drizzle and Cypher queries have been audited to avoid N+1 anti-patterns.
- [ ] BullMQ workers define strict concurrency limits to prevent container depletion.
```
