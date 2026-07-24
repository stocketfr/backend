-- Inventory identity is (tenant, product, location, area), with NULL areas
-- treated as equal. Take the constraint operation's strongest lock up front
-- so no create or move can introduce a duplicate between reconciliation and
-- installation, and so PostgreSQL never needs a deadlock-prone lock upgrade.
-- Inventory reads and writes pause until this short transaction completes.
LOCK TABLE "inventory" IN ACCESS EXCLUSIVE MODE;

-- Reconcile split balances deterministically. The most recently updated row
-- is canonical and keeps the identity's non-quantity metadata; quantity is
-- summed so stock is not lost. There are currently no foreign keys to
-- inventory.id, so deleting redundant rows cannot orphan persisted records.
WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "tenant_id", "product_id", "location_id", "area_id"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS canonical_id,
    sum("quantity") OVER (
      PARTITION BY "tenant_id", "product_id", "location_id", "area_id"
    )::integer AS reconciled_quantity,
    count(*) OVER (
      PARTITION BY "tenant_id", "product_id", "location_id", "area_id"
    ) AS duplicate_count
  FROM "inventory"
), reconciled AS (
  UPDATE "inventory" AS target
  SET
    "quantity" = ranked."reconciled_quantity",
    "updated_at" = now()
  FROM ranked
  WHERE ranked."duplicate_count" > 1
    AND ranked."id" = ranked."canonical_id"
    AND target."id" = ranked."canonical_id"
  RETURNING target."id"
)
DELETE FROM "inventory" AS redundant
USING ranked
WHERE ranked."duplicate_count" > 1
  AND ranked."id" <> ranked."canonical_id"
  AND redundant."id" = ranked."id";

ALTER TABLE "inventory"
  ADD CONSTRAINT "inventory_tenant_product_location_area_unique"
  UNIQUE NULLS NOT DISTINCT (
    "tenant_id",
    "product_id",
    "location_id",
    "area_id"
  );

-- Rollback: dropping the constraint restores the previous write behavior:
-- ALTER TABLE "inventory"
--   DROP CONSTRAINT "inventory_tenant_product_location_area_unique";
-- Reconciled rows cannot be split back losslessly; restore a pre-migration
-- backup if exact duplicate rows (rather than their total balance) are needed.
