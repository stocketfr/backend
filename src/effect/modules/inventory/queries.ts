import {
  and,
  eq,
  gte,
  ilike,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { InventoryQueryDto } from '@stocket/types/inventory';
import { InventorySortField } from '@stocket/types/inventory';
import { buildOrderBy } from '../../platform/db/drizzle-sort.utils';
import { type DrizzleDb } from '../../platform/db/drizzle';
import {
  areas,
  inventory,
  locations,
  products,
} from '../../platform/db/schema';
import type { InventoryJoinRow, InventoryWithRelations } from './types';

export function buildInventoryFilters(query: InventoryQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (query.product_id) {
    conditions.push(eq(inventory.product_id, query.product_id));
  }
  if (query.location_id) {
    conditions.push(eq(inventory.location_id, query.location_id));
  }
  if (query.area_id) {
    conditions.push(eq(inventory.area_id, query.area_id));
  }
  if (query.search) {
    conditions.push(
      or(
        ilike(products.name, `%${query.search}%`),
        ilike(products.sku, `%${query.search}%`),
      )!,
    );
  }
  if (query.low_stock) {
    conditions.push(sql`${inventory.quantity} <= ${products.reorder_point}`);
  }
  if (query.expiring_soon) {
    conditions.push(
      sql`${inventory.expiry_date} IS NOT NULL AND ${inventory.expiry_date} <= NOW() + INTERVAL '30 days'`,
    );
  }
  if (query.min_quantity !== undefined && query.max_quantity !== undefined) {
    conditions.push(
      sql`${inventory.quantity} BETWEEN ${query.min_quantity} AND ${query.max_quantity}`,
    );
  } else if (query.min_quantity !== undefined) {
    conditions.push(gte(inventory.quantity, query.min_quantity));
  } else if (query.max_quantity !== undefined) {
    conditions.push(lte(inventory.quantity, query.max_quantity));
  }
  return conditions;
}

const inventorySortColumns = {
  [InventorySortField.QUANTITY]: inventory.quantity,
  [InventorySortField.EXPIRY_DATE]: inventory.expiry_date,
  [InventorySortField.RECEIVED_DATE]: inventory.received_date,
  [InventorySortField.CREATED_AT]: inventory.created_at,
  [InventorySortField.UPDATED_AT]: inventory.updated_at,
} as const;

export function getInventoryOrderBy(
  sortBy?: InventorySortField,
  sortOrder?: 'ASC' | 'DESC',
) {
  return buildOrderBy(
    inventorySortColumns,
    sortBy ?? InventorySortField.UPDATED_AT,
    sortOrder ?? 'DESC',
  );
}

export function selectInventoryWithJoins(db: DrizzleDb) {
  return db
    .select({
      inv: inventory,
      product: products,
      location: locations,
      area: areas,
    })
    .from(inventory)
    .leftJoin(
      products,
      and(
        eq(inventory.product_id, products.id),
        eq(inventory.tenant_id, products.tenant_id),
      ),
    )
    .leftJoin(
      locations,
      and(
        eq(inventory.location_id, locations.id),
        eq(inventory.tenant_id, locations.tenant_id),
      ),
    )
    .leftJoin(
      areas,
      and(
        eq(inventory.area_id, areas.id),
        eq(inventory.tenant_id, areas.tenant_id),
      ),
    );
}

export function mapInventoryRow(row: InventoryJoinRow): InventoryWithRelations {
  return {
    ...row.inv,
    product: row.product,
    location: row.location,
    area: row.area,
  };
}
