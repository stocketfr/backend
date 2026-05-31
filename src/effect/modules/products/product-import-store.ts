import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { LocationType } from '@stocket/types/locations';
import type { ProductImportResultDto } from '@stocket/types/products';
import type { DrizzleDb } from '../../platform/db/drizzle';
import {
  categories,
  inventory,
  locations,
  products,
} from '../../platform/db/schema';
import type {
  ProductImportLogger,
  ProductImportRow,
} from './product-import.types';

type CategoryRow = typeof categories.$inferSelect;
type ProductRow = typeof products.$inferSelect;

interface ProductImportStoreOptions {
  db: DrizzleDb;
  tenantId: string;
  stats: ProductImportResultDto;
  logger?: ProductImportLogger;
}

interface UpsertProductInput {
  categoryId: string;
  row: ProductImportRow;
  userId: string;
}

export function makeProductImportStore({
  db,
  tenantId,
  stats,
  logger,
}: ProductImportStoreOptions) {
  const categoryCache = new Map<string, string>();
  const locationCache = new Map<string, string>();

  const getOrCreateCategoryPath = async (
    categoryPath: string,
  ): Promise<string> => {
    const parts = categoryPath
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    return getOrCreateCategoryParts(
      parts.length > 0 ? parts : ['Uncategorized'],
    );
  };

  const getOrCreateLocation = async (
    locationName: string,
  ): Promise<string | null> => {
    const name = locationName.trim();
    if (!name) return null;

    const cached = locationCache.get(name);
    if (cached) return cached;

    const location = await findLocation(name);
    if (location) {
      locationCache.set(name, location.id);
      return location.id;
    }

    const created = await createLocation(name);
    locationCache.set(name, created.id);
    return created.id;
  };

  const upsertProduct = async ({
    categoryId,
    row,
    userId,
  }: UpsertProductInput): Promise<ProductRow> => {
    const productValues = {
      name: row.name,
      description: row.description,
      category_id: categoryId,
      unit: row.unit,
      barcode: row.barcode,
      standard_price: row.standardPrice,
      reorder_point: row.reorderPoint,
      is_active: row.isActive,
      is_perishable: row.isPerishable,
      notes: row.notes,
      updated_by: userId,
    };

    const product = await findProductBySku(row.sku);
    if (!product) {
      const created = await createProduct({
        sku: row.sku,
        ...productValues,
        created_by: userId,
      });
      stats.productsCreated++;
      return created;
    }

    const updated = await updateProduct(product.id, productValues);
    stats.productsUpdated++;
    return updated;
  };

  const syncInventory = async (
    productId: string,
    row: ProductImportRow,
  ): Promise<void> => {
    const locationId = await getOrCreateLocation(row.locationName);
    if (!locationId) return;

    const existing = await findInventory(productId, locationId);
    if (!existing) {
      await db.insert(inventory).values({
        tenant_id: tenantId,
        product_id: productId,
        location_id: locationId,
        quantity: row.quantity,
        expiry_date: row.expiryDate,
      });
      stats.inventoryRecordsCreated++;
      return;
    }

    await db
      .update(inventory)
      .set({
        quantity: row.quantity,
        ...(row.expiryDate && { expiry_date: row.expiryDate }),
      })
      .where(
        and(eq(inventory.tenant_id, tenantId), eq(inventory.id, existing.id)),
      );
    stats.inventoryRecordsUpdated++;
  };

  const getOrCreateCategoryParts = async (parts: string[]): Promise<string> => {
    let parentId: string | null = null;
    let categoryId = '';

    for (const part of parts) {
      const cacheKey = `${parentId ?? 'root'}:${part}`;
      const cached = categoryCache.get(cacheKey);
      if (cached) {
        parentId = cached;
        categoryId = cached;
        continue;
      }

      const category = await findOrCreateCategory(part, parentId, parts);
      categoryCache.set(cacheKey, category.id);
      parentId = category.id;
      categoryId = category.id;
    }

    return categoryId;
  };

  const findOrCreateCategory = async (
    name: string,
    parentId: string | null,
    fullPath: string[],
  ): Promise<CategoryRow> => {
    const existing = await findCategory(name, parentId);
    if (existing) return existing;

    const created = await createCategory(name, parentId);
    stats.categoriesCreated++;
    logger?.info(`Created category: ${fullPath.join(' / ')}`);
    return created;
  };

  const findCategory = async (
    name: string,
    parentId: string | null,
  ): Promise<CategoryRow | null> => {
    const where: SQL = (
      parentId === null
        ? and(
            eq(categories.tenant_id, tenantId),
            eq(categories.name, name),
            isNull(categories.parent_id),
          )
        : and(
            eq(categories.tenant_id, tenantId),
            eq(categories.name, name),
            eq(categories.parent_id, parentId),
          )
    )!;

    const rows: CategoryRow[] = await db
      .select()
      .from(categories)
      .where(where)
      .limit(1);
    return rows[0] ?? null;
  };

  const createCategory = async (
    name: string,
    parentId: string | null,
  ): Promise<CategoryRow> => {
    const rows: CategoryRow[] = await db
      .insert(categories)
      .values({
        tenant_id: tenantId,
        name,
        parent_id: parentId,
        description: 'Imported via product import',
      })
      .returning();
    const category = rows[0];
    if (!category) {
      throw new Error(`Failed to create category: ${name}`);
    }
    return category;
  };

  const findLocation = async (name: string) => {
    const rows = await db
      .select()
      .from(locations)
      .where(and(eq(locations.tenant_id, tenantId), eq(locations.name, name)))
      .limit(1);
    return rows[0] ?? null;
  };

  const createLocation = async (name: string) => {
    const [created] = await db
      .insert(locations)
      .values({
        tenant_id: tenantId,
        name,
        type: LocationType.WAREHOUSE,
        is_active: true,
      })
      .returning();
    if (!created) {
      throw new Error(`Failed to create location: ${name}`);
    }
    stats.locationsCreated++;
    logger?.info(`Created location: ${name}`);
    return created;
  };

  const findProductBySku = async (sku: string): Promise<ProductRow | null> => {
    const rows = await db
      .select()
      .from(products)
      .where(and(eq(products.tenant_id, tenantId), eq(products.sku, sku)))
      .limit(1);
    return rows[0] ?? null;
  };

  const createProduct = async (
    values: typeof products.$inferInsert,
  ): Promise<ProductRow> => {
    const [created] = await db
      .insert(products)
      .values({
        tenant_id: tenantId,
        ...values,
      })
      .returning();
    if (!created) {
      throw new Error(`Failed to create product: ${values.sku}`);
    }
    return created;
  };

  const updateProduct = async (
    productId: string,
    values: Partial<typeof products.$inferInsert>,
  ): Promise<ProductRow> => {
    const [updated] = await db
      .update(products)
      .set(values)
      .where(and(eq(products.tenant_id, tenantId), eq(products.id, productId)))
      .returning();
    if (!updated) {
      throw new Error(`Failed to update product: ${productId}`);
    }
    return updated;
  };

  const findInventory = async (productId: string, locationId: string) => {
    const rows = await db
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.tenant_id, tenantId),
          eq(inventory.product_id, productId),
          eq(inventory.location_id, locationId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  };

  return {
    getOrCreateCategoryPath,
    syncInventory,
    upsertProduct,
  };
}
