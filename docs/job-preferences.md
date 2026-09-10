# Optional job preferences and incomplete profiles

Apply `migrations/20260905_job_preferences.sql` to the intended PostgreSQL database before testing preference saves. This is an additive table only; do not run a broad schema push for this change. Restart the API and matcher worker after deploying. No migration is applied automatically by the application.

Authenticated endpoints (existing jobs rate limit):
- GET `/api/jobs/preferences`: `{ preferences }`.
- PATCH `/api/jobs/preferences`: partial object with `desiredRoles`, `locations`, `workModes`, `employmentTypes`. `null` means unanswered, `[]` means explicitly any. Omitted fields are preserved. Maximum 10 role/location choices, 120 characters each. Unknown fields rejected.
- GET `/api/jobs/roles?q=backend`: up to 100 distinct mapped role titles from active jobs posted within 3 days. Exact normalized role selection, not semantic role inference.
- GET `/api/jobs`: now includes `feed` context and `preferences`. Users with no skills receive recent listings; `matchPercent` is null and `requiredSkills` contains neutral job requirements. Exploration does not overwrite personalized/email job matches.

Provided role, location, work-mode and employment preferences restrict candidates. Unanswered/any fields do not restrict candidates, but remain distinguishable in storage. Specific city matching currently uses case-insensitive substring matching; work modes have basic spelling normalization. No inferred role, related-role or stretch model is introduced in this increment. Existing skill/experience ranking remains a baseline, not a calibrated overall fit score.

Migration rollout: reads fall back to unanswered preferences if the new table is absent; saves return 503 with a browse-safe message. Other database failures are not hidden.

Verification:
`node --test src/services/jobPreferences.test.js`
`node --experimental-test-module-mocks --test src/services/jobFeed.integration.test.js`

The second suite mocks PostgreSQL and Neo4j; it verifies service responses, parameter wiring, cleanup, and browse-write isolation without touching real user data. It does not establish live Cypher performance or job relevance.

Manual acceptance on the intended local database:
1. New account with no skills: recent feed, no personalized percentages, skip preferences and apply links remain usable.
2. Save a role only: mapped role listings, no skill score; refresh/relogin preserves role.
3. Upload/process resume: skill coverage becomes available, preferences/master resume remain separate.
4. Set city/work mode/employment; check all returned listings against these restrictions.
5. Compare Not answered, Any, and selected choices across save/reload.
6. No matches: no silent broadening; edit preferences or change the date window.
7. Switch accounts: no previous user's feed/preferences.
8. Check query latency/counts with real Neo4j data before production rollout.
