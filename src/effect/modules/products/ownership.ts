import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { products } from '../../platform/db/schema';

export const productBelongsToTenantSql = (
  productIdExpression: unknown,
  tenantId: string,
) =>
  sql`${productIdExpression} IN (SELECT id FROM products WHERE tenant_id = ${tenantId})`;

export const assertProductBelongsToTenant = async (
  db: DrizzleDb,
  tenantId: string,
  productId: string,
) => {
  const productRows = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenant_id, tenantId), eq(products.id, productId)))
    .limit(1);
  if (productRows.length === 0) {
    throw new Error('Product does not belong to tenant');
  }
};
