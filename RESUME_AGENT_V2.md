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

Run the isolated deterministic and document tests with:

```bash
npm test
```
