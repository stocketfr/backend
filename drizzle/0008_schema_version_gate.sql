-- stocket:previous-app-compatible=true
CREATE TABLE IF NOT EXISTS "stocket_schema_version" (
  "singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
  "version" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "stocket_schema_version_singleton_check" CHECK ("singleton")
);
