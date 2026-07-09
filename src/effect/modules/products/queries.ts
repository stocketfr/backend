import { and, eq, gte, ilike, lte, or, sql, type SQL } from 'drizzle-orm';
import { ProductSortField } from '@stocket/types/products';
import { buildOrderBy } from '../../platform/db/drizzle-sort.utils';
import { type DrizzleDb } from '../../platform/db/drizzle';
import { categories, products, suppliers } from '../../platform/db/schema';
import type {
  ProductJoinRow,
  ProductQueryDto,
  ProductWithRelations,
} from './types';

export function selectProductWithJoins(db: DrizzleDb) {
  return db
    .select({
      product: products,
      category: categories,
      supplier: suppliers,
    })
    .from(products)
    .leftJoin(
      categories,
      and(
        eq(products.category_id, categories.id),
        eq(products.tenant_id, categories.tenant_id),
      ),
    )
    .leftJoin(
      suppliers,
      and(
        eq(products.primary_supplier_id, suppliers.id),
        eq(products.tenant_id, suppliers.tenant_id),
      ),
    );
}

export function mapProductRow(row: ProductJoinRow): ProductWithRelations {
  return {
    ...row.product,
    category: row.category,
    primary_supplier: row.supplier,
  };
}

export function buildProductFilters(query: ProductQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (query.search) {
    conditions.push(
      or(
        ilike(products.name, `%${query.search}%`),
        ilike(products.sku, `%${query.search}%`),
      )!,
    );
  }
  if (query.category_id) {
    conditions.push(eq(products.category_id, query.category_id));
  }
  if (query.primary_supplier_id) {
    conditions.push(
      eq(products.primary_supplier_id, query.primary_supplier_id),
    );
  }
  if (query.is_active !== undefined) {
    conditions.push(eq(products.is_active, query.is_active));
  }
  if (query.is_perishable !== undefined) {
    conditions.push(eq(products.is_perishable, query.is_perishable));
  }
  if (query.min_price !== undefined && query.max_price !== undefined) {
    conditions.push(
      sql`${products.standard_price} BETWEEN ${query.min_price} AND ${query.max_price}`,
    );
  } else if (query.min_price !== undefined) {
    conditions.push(gte(products.standard_price, query.min_price));
  } else if (query.max_price !== undefined) {
    conditions.push(lte(products.standard_price, query.max_price));
  }
  return conditions;
}

const productSortColumns = {
  [ProductSortField.NAME]: products.name,
  [ProductSortField.SKU]: products.sku,
  [ProductSortField.CREATED_AT]: products.created_at,
  [ProductSortField.UPDATED_AT]: products.updated_at,
  [ProductSortField.STANDARD_PRICE]: products.standard_price,
  [ProductSortField.STANDARD_COST]: products.standard_cost,
  [ProductSortField.REORDER_POINT]: products.reorder_point,
} as const;

export const getProductOrderBy = (query: ProductQueryDto) =>
  buildOrderBy(productSortColumns, query.sort_by, query.sort_order);
