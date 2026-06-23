CREATE TABLE IF NOT EXISTS "tenant_feature_overrides" (
  "tenant_id" uuid NOT NULL,
  "feature_key" varchar(100) NOT NULL,
  "enabled" boolean NOT NULL,
  "expires_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_by" text,
  CONSTRAINT "tenant_feature_overrides_tenant_id_feature_key_pk" PRIMARY KEY("tenant_id","feature_key")
);

DO $$ BEGIN
 ALTER TABLE "tenant_feature_overrides"
 ADD CONSTRAINT "tenant_feature_overrides_tenant_id_organization_id_fk"
 FOREIGN KEY ("tenant_id") REFERENCES "public"."organization"("id")
 ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "tenant_feature_overrides_tenant_id_idx"
ON "tenant_feature_overrides" USING btree ("tenant_id");
