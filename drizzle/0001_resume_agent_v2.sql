ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "source_type" varchar(50) DEFAULT 'platform';
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "ats_vendor" varchar(100);
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "career_page_url" text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "application_url" text;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "requirements_json" jsonb;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "screening_questions_json" jsonb;

ALTER TYPE "version_source" ADD VALUE IF NOT EXISTS 'career_optimize';
ALTER TYPE "version_source" ADD VALUE IF NOT EXISTS 'manual_jd';
ALTER TYPE "version_source" ADD VALUE IF NOT EXISTS 'agent_chat';
ALTER TYPE "version_source" ADD VALUE IF NOT EXISTS 'fact_confirmation';

DO $$ BEGIN CREATE TYPE "resume_agent_target_type" AS ENUM ('platform_market', 'career_job', 'manual_jd'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "resume_agent_target_status" AS ENUM ('ready', 'failed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "resume_agent_run_status" AS ENUM ('pending', 'analyzing', 'awaiting_confirmation', 'applying', 'validating', 'completed', 'no_improvement', 'failed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "resume_fact_source" AS ENUM ('resume', 'user_attested', 'imported'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "resume_fact_status" AS ENUM ('verified', 'rejected', 'superseded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "resume_proposal_status" AS ENUM ('proposed', 'approved', 'rejected', 'applied', 'blocked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "resume_agent_message_role" AS ENUM ('user', 'assistant', 'tool', 'system'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "resume_credit_reservation_status" AS ENUM ('reserved', 'consumed', 'released'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "resume_agent_targets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "resume_workspaces"("id") ON DELETE CASCADE,
  "type" "resume_agent_target_type" NOT NULL,
  "status" "resume_agent_target_status" NOT NULL DEFAULT 'ready',
  "platform" varchar(100),
  "job_source_id" varchar(255),
  "company_name" text,
  "job_title" text NOT NULL,
  "job_url" text,
  "application_url" text,
  "ats_vendor" varchar(100),
  "source_snapshot_json" jsonb NOT NULL,
  "requirements_json" jsonb NOT NULL,
  "fingerprint" varchar(64) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "resume_agent_targets_user_idx" ON "resume_agent_targets" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "resume_agent_targets_workspace_idx" ON "resume_agent_targets" ("workspace_id");
CREATE INDEX IF NOT EXISTS "resume_agent_targets_fingerprint_idx" ON "resume_agent_targets" ("user_id", "fingerprint");

CREATE TABLE IF NOT EXISTS "resume_agent_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "resume_workspaces"("id") ON DELETE CASCADE,
  "target_id" uuid NOT NULL REFERENCES "resume_agent_targets"("id") ON DELETE CASCADE,
  "base_version_id" uuid NOT NULL REFERENCES "resume_versions"("id") ON DELETE RESTRICT,
  "output_version_id" uuid REFERENCES "resume_versions"("id") ON DELETE SET NULL,
  "status" "resume_agent_run_status" NOT NULL DEFAULT 'pending',
  "mode" varchar(30) NOT NULL DEFAULT 'optimize',
  "idempotency_key" varchar(128) NOT NULL,
  "score_before_json" jsonb,
  "score_after_json" jsonb,
  "result_json" jsonb,
  "error_code" varchar(80),
  "error_message" text,
  "started_at" timestamptz,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "resume_agent_runs_user_idx" ON "resume_agent_runs" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "resume_agent_runs_target_idx" ON "resume_agent_runs" ("target_id");
CREATE UNIQUE INDEX IF NOT EXISTS "resume_agent_runs_user_idempotency_idx" ON "resume_agent_runs" ("user_id", "idempotency_key");

CREATE TABLE IF NOT EXISTS "resume_fact_assertions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL REFERENCES "resume_workspaces"("id") ON DELETE CASCADE,
  "run_id" uuid REFERENCES "resume_agent_runs"("id") ON DELETE SET NULL,
  "fact_type" varchar(80) NOT NULL,
  "fact_key" text NOT NULL,
  "value_json" jsonb NOT NULL,
  "evidence_json" jsonb NOT NULL,
  "source" "resume_fact_source" NOT NULL,
  "status" "resume_fact_status" NOT NULL DEFAULT 'verified',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "resume_fact_assertions_user_idx" ON "resume_fact_assertions" ("user_id", "fact_type");
CREATE INDEX IF NOT EXISTS "resume_fact_assertions_workspace_idx" ON "resume_fact_assertions" ("workspace_id");

CREATE TABLE IF NOT EXISTS "resume_change_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "resume_agent_runs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "proposal_type" varchar(80) NOT NULL,
  "target_path" text NOT NULL,
  "before_json" jsonb,
  "after_json" jsonb NOT NULL,
  "rationale" text NOT NULL,
  "evidence_json" jsonb NOT NULL,
  "requires_confirmation" boolean NOT NULL DEFAULT false,
  "status" "resume_proposal_status" NOT NULL DEFAULT 'proposed',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "decided_at" timestamptz,
  "applied_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "resume_change_proposals_run_idx" ON "resume_change_proposals" ("run_id", "status");
CREATE INDEX IF NOT EXISTS "resume_change_proposals_user_idx" ON "resume_change_proposals" ("user_id");

CREATE TABLE IF NOT EXISTS "resume_agent_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "resume_agent_runs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" "resume_agent_message_role" NOT NULL,
  "content" text NOT NULL,
  "intent" varchar(80),
  "client_message_id" varchar(128),
  "metadata_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "resume_agent_messages_run_time_idx" ON "resume_agent_messages" ("run_id", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "resume_agent_messages_client_id_idx" ON "resume_agent_messages" ("run_id", "client_message_id");

CREATE TABLE IF NOT EXISTS "resume_agent_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL REFERENCES "resume_agent_runs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_type" varchar(100) NOT NULL,
  "payload_json" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "resume_agent_events_run_time_idx" ON "resume_agent_events" ("run_id", "created_at");

CREATE TABLE IF NOT EXISTS "resume_credit_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "run_id" uuid NOT NULL UNIQUE REFERENCES "resume_agent_runs"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "amount" integer NOT NULL CHECK ("amount" >= 0),
  "status" "resume_credit_reservation_status" NOT NULL DEFAULT 'reserved',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "resume_credit_reservations_user_status_idx" ON "resume_credit_reservations" ("user_id", "status");

