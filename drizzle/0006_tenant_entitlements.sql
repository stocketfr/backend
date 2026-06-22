CREATE TYPE "public"."tenant_plan_key" AS ENUM('free', 'base', 'growth', 'enterprise');
CREATE TYPE "public"."tenant_entitlement_source" AS ENUM('system', 'manual', 'billing');
CREATE TYPE "public"."tenant_feature_key" AS ENUM('smartImport', 'orders');

CREATE TABLE "tenant_entitlement_profiles" (
  "tenant_id" uuid PRIMARY KEY NOT NULL,
  "plan_key" "tenant_plan_key" DEFAULT 'free' NOT NULL,
  "source" "tenant_entitlement_source" DEFAULT 'system' NOT NULL,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "tenant_feature_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "feature_key" "tenant_feature_key" NOT NULL,
  "enabled" boolean NOT NULL,
  "reason" text,
  "expires_at" timestamp with time zone,
  "updated_by" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "tenant_entitlement_profiles"
  ADD CONSTRAINT "tenant_entitlement_profiles_tenant_id_organization_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "tenant_feature_overrides"
  ADD CONSTRAINT "tenant_feature_overrides_tenant_id_organization_id_fk"
  FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id")
  ON DELETE cascade ON UPDATE no action;

CREATE INDEX "tenant_entitlement_profiles_plan_key_idx"
  ON "tenant_entitlement_profiles" USING btree ("plan_key");

CREATE UNIQUE INDEX "tenant_feature_overrides_tenant_feature_unique"
  ON "tenant_feature_overrides" USING btree ("tenant_id","feature_key");

CREATE INDEX "tenant_feature_overrides_tenant_id_idx"
  ON "tenant_feature_overrides" USING btree ("tenant_id");

CREATE INDEX "tenant_feature_overrides_expires_at_idx"
  ON "tenant_feature_overrides" USING btree ("expires_at");
