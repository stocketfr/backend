ALTER TABLE "photos"
  ADD COLUMN IF NOT EXISTS "source_url" text,
  ADD COLUMN IF NOT EXISTS "source_hash" varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS "photos_product_source_hash_unique"
  ON "photos" USING btree ("product_id", "source_hash")
  WHERE "source_hash" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "background_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
  "type" varchar(100) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "payload" jsonb,
  "result" jsonb,
  "error" text,
  "created_by" text,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "run_after" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_owner" text,
  "lease_expires_at" timestamp with time zone,
  "progress_total" integer,
  "progress_processed" integer DEFAULT 0 NOT NULL,
  "progress_failed" integer DEFAULT 0 NOT NULL,
  "progress_message" text,
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
    )
);

CREATE INDEX IF NOT EXISTS "background_tasks_tenant_type_status_created_idx"
  ON "background_tasks" USING btree ("tenant_id", "type", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "background_tasks_queued_claim_idx"
  ON "background_tasks" USING btree ("run_after", "created_at")
  WHERE "status" = 'queued';

CREATE INDEX IF NOT EXISTS "background_tasks_expired_running_idx"
  ON "background_tasks" USING btree ("lease_expires_at")
  WHERE "status" = 'running';
