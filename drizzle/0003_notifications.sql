-- Note: the user.locale column is NOT added here. It is a
-- better-auth `additionalFields` value (see backend/src/auth.ts) created by
-- better-auth's own migrations, which own the "user" table. Committed SQL must
-- not assume "user" exists (cf. 0001's guard; the integration harness never
-- creates it). The Drizzle schema mirror of those columns is only for typing.

CREATE TABLE IF NOT EXISTS "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" text NOT NULL,
	"category" varchar(50) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001' NOT NULL,
	"user_id" text NOT NULL,
	"event_kind" varchar(50) NOT NULL,
	"category" varchar(50) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"dedupe_key" text,
	"status" varchar(20) NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_preferences_unique" ON "notification_preferences" USING btree ("tenant_id","user_id","category","channel");
CREATE INDEX IF NOT EXISTS "notification_preferences_tenant_user_idx" ON "notification_preferences" USING btree ("tenant_id","user_id");
CREATE INDEX IF NOT EXISTS "notification_preferences_audience_idx" ON "notification_preferences" USING btree ("tenant_id","category","channel");
CREATE INDEX IF NOT EXISTS "notifications_tenant_user_idx" ON "notifications" USING btree ("tenant_id","user_id");
CREATE INDEX IF NOT EXISTS "notifications_status_idx" ON "notifications" USING btree ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_dedupe_key_unique" ON "notifications" USING btree ("dedupe_key") WHERE dedupe_key is not null;
