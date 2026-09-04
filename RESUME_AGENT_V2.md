# Resume Agent v2 Backend

Resume Agent v2 replaces the legacy platform optimizer, workspace copilot, manual editor, and JD optimizer with one authenticated API and one durable worker.

## Runtime flow

1. Create a target from platform-market jobs, a stored/supplied career-page job, or a manual JD.
2. Create an idempotent run against an owned resume version.
3. The `resume-agent-worker` analyses and scores the resume, asks the configured model for controlled proposals, validates every proposal against verified facts, and applies only evidence-safe improvements.
4. If no transparent score improves, the original version remains active and the credit reservation is released.
5. A new immutable version is created only after validation succeeds.
6. PDF and DOCX downloads are parsed back before being returned.

## API

All routes require the existing authentication middleware and are mounted below `/api/resume-agent`.

- `GET /workspace` returns the active version pointer and immutable version history.
- `GET /versions/:versionId` returns a user-owned structured resume snapshot for live preview.
- `GET /platforms/:platform/roles?search=&limit=100` returns canonical roles backed by recent jobs on that platform. Platform target creation rejects roles that are not currently available.

### Targets

- `POST /targets/platform`
  - Body: `{ platform, role, location?, minExperience?, maxExperience?, sampleSize? }`
- `POST /targets/career-page`
  - Body: `{ jobSourceId? }` or `{ jobTitle, jobDescription, companyName?, atsVendor?, jobUrl?, applicationUrl?, screeningQuestions? }`
- `POST /targets/manual-jd`
  - Body: `{ jobTitle, jobDescription, companyName?, platform?, atsVendor?, jobUrl?, applicationUrl? }`
- `GET /targets/:targetId`

### Runs

- `POST /runs`
  - Body: `{ targetId, baseVersionId?, mode: "analyze" | "optimize", idempotencyKey }`
  - Returns `202` for a new queued run and `200` for an idempotent replay.
- `GET /runs/:runId`
- `GET /runs/:runId/events`

Run states are `pending`, `analyzing`, `awaiting_confirmation`, `applying`, `validating`, `completed`, `no_improvement`, `failed`, and `cancelled`.

### Conversational agent

- `POST /runs/:runId/chat`
  - Body: `{ message, clientMessageId? }`
- `GET /runs/:runId/messages?limit=50&before=<ISO timestamp>`
- `POST /runs/:runId/missing-skills/confirm`
  - Body example:

```json
{
  "skill": "Kubernetes",
  "confirmation": "used_professionally",
  "organizationOrProject": "Current employer",
  "usageDetails": "Deployed three Spring Boot services using deployments and services.",
  "metric": "Reduced manual deployment time by 40%.",
  "applyTo": "experience"
}
```

Valid confirmation values are `used_professionally`, `used_in_project`, `completed_course`, `basic_knowledge`, and `not_used`. A click is not treated as evidence; professional and project claims require usage details.

### Proposals and documents

- `POST /proposals/:proposalId/decision`
  - Body: `{ decision: "approve" | "reject" }`
  - Evidence-blocked proposals cannot be approved directly; the missing fact must be confirmed.
- `GET /versions/:versionId/download/pdf`
- `GET /versions/:versionId/download/docx`
- `GET /tools`

## Scores

The API stores a score bundle rather than claiming an official third-party ATS score:

- `atsCompatibility`: structured-resume and machine-readability checks.
- `targetMatch`: required/preferred skills, responsibilities, experience, and title/domain alignment.
- `resumeQuality`: evidence, specificity, clarity, and relevance.
- `overall`: a documented weighted aggregate used only to decide whether a generated version is an improvement.

## Persistence

New writes use:

- `resume_agent_targets`
- `resume_agent_runs`
- `resume_fact_assertions`
- `resume_change_proposals`
- `resume_agent_messages`
- `resume_agent_events`
- `resume_credit_reservations`

The old tables remain in the database for data migration/audit, but their HTTP routes and worker are removed.

Apply the idempotent database migration before starting the API and worker:

```bash
npm run db:migrate:resume-agent
```

Platform-market targets are read directly from Neo4j, where the complete scraped job graph lives. Prepare existing graph data once so source filtering uses indexes:

```bash
npm run graph:prepare:resume-agent
```

Future scraper ingestion should write `j.source_normalized = toLower(trim($source))`. The runtime query retains a compatibility fallback for jobs ingested before that field existed.

Platform targets use jobs posted in the last `RESUME_AGENT_PLATFORM_MAX_AGE_DAYS` (7 by default). This keeps the generated resume aligned with current platform demand and protects trends from stale records even when older ingestion code calculated `expires_at` from ingestion time instead of `posted_at`.

### Required scraper-ingestion corrections

The Neo4j ingestion query used by the scraper should also:

- persist `j.description`, because passing it as a Cypher parameter does not store it;
- persist `j.source_normalized = toLower(trim($source))` for indexed platform filtering;
- set `j.expires_at = datetime($posted_at) + duration({days: $expiry_days})`, rather than calculating expiry from the ingestion time;
- use `ON CREATE SET j.created_at = datetime()` and a separate `j.updated_at` field so re-ingestion does not rewrite creation time;
- remove obsolete `REQUIRES`, `USES_TOOL`, and `MAPS_TO` relationships before rebuilding a previously ingested job, otherwise removed skills remain connected;
- delete existing role-level `REQUIRES` aggregates before recreating the top-20 links in post-processing, otherwise skills that fall out of the top 20 remain stale.

Resume Agent calculates platform skill demand directly from the selected job sample, so global `Skill.demand_rank` and role-level top-20 links are useful for other product features but are not used as the source of truth for resume targeting.

Run the isolated deterministic and document tests with:

```bash
npm test
```

Run the resume worker locally with:

```bash
npm run worker:resume-agent
```

Verify the configured model provider with synthetic data (this makes one small provider request and sends no user resume data):

```bash
npm run test:resume-agent:provider
```
