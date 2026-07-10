CREATE TABLE IF NOT EXISTS "background_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
  "type" varchar(100) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "payload" jsonb,
  "result" jsonb,
  "error" text,
  "created_by" text NOT NULL,
  "idempotency_key" varchar(200),
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "run_after" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_owner" text,
  "lease_token" uuid,
  "lease_expires_at" timestamp with time zone,
  "progress_total" integer,
  "progress_processed" integer DEFAULT 0 NOT NULL,
  "progress_failed" integer DEFAULT 0 NOT NULL,
  "progress_message_key" varchar(200),
  "progress_message_args" jsonb,
  "cancel_requested_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "background_tasks_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'canceled')),
  CONSTRAINT "background_tasks_attempts_check"
    CHECK ("attempt_count" >= 0 AND "max_attempts" > 0),
  CONSTRAINT "background_tasks_progress_check"
    CHECK (
      "progress_processed" >= 0
      AND "progress_failed" >= 0
      AND ("progress_total" IS NULL OR "progress_total" >= 0)
    ),
  CONSTRAINT "background_tasks_payload_check"
    CHECK ("status" NOT IN ('queued', 'running') OR "payload" IS NOT NULL),
  CONSTRAINT "background_tasks_lease_check"
    CHECK (
      (
        "status" = 'running'
        AND "lease_owner" IS NOT NULL
        AND "lease_token" IS NOT NULL
        AND "lease_expires_at" IS NOT NULL
      )
      OR
      (
        "status" <> 'running'
        AND "lease_owner" IS NULL
        AND "lease_token" IS NULL
        AND "lease_expires_at" IS NULL
      )
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "background_tasks_tenant_creator_type_idempotency_unique"
  ON "background_tasks" USING btree ("tenant_id", "created_by", "type", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "background_tasks_tenant_creator_created_idx"
  ON "background_tasks" USING btree ("tenant_id", "created_by", "created_at");

CREATE INDEX IF NOT EXISTS "background_tasks_tenant_type_status_created_idx"
  ON "background_tasks" USING btree ("tenant_id", "type", "status", "created_at");

CREATE INDEX IF NOT EXISTS "background_tasks_queued_claim_idx"
  ON "background_tasks" USING btree ("run_after", "created_at")
  WHERE "status" = 'queued';

CREATE INDEX IF NOT EXISTS "background_tasks_expired_running_idx"
  ON "background_tasks" USING btree ("lease_expires_at")
  WHERE "status" = 'running';
