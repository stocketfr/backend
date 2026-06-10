CREATE INDEX IF NOT EXISTS "categories_tenant_id_idx" ON "categories" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "locations_tenant_id_idx" ON "locations" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "suppliers_tenant_id_idx" ON "suppliers" USING btree ("tenant_id");
CREATE INDEX IF NOT EXISTS "areas_tenant_id_idx" ON "areas" USING btree ("tenant_id");
