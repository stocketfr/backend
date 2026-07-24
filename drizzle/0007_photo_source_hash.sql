-- stocket:previous-app-compatible=true
ALTER TABLE "photos"
  ADD COLUMN IF NOT EXISTS "source_hash" varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS "photos_product_source_hash_unique"
  ON "photos" USING btree ("product_id", "source_hash")
  WHERE "source_hash" IS NOT NULL;
