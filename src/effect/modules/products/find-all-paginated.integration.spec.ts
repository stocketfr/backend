import { Effect, Layer } from 'effect';
import { ProductSortField } from '@stocket/types/products';
import { SortOrder } from '@stocket/types/common';
import type { DrizzleDb } from '../../platform/db/drizzle';
import {
  getTestDb,
  makeTestDrizzleLayer,
  runTest,
  seedCategory,
  seedProduct,
  seedSupplier,
  TEST_USER_ID,
  withTestDb,
} from '../../testing/test-harness';
import { ProductsService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<ProductsService>;

withTestDb();
beforeAll(() => {
  db = getTestDb();
  TestLayer = ProductsService.Default.pipe(
    Layer.provide(makeTestDrizzleLayer()),
  );
});

const listProducts = (query: Record<string, unknown>) =>
  runTest(
    Effect.flatMap(ProductsService, (svc) =>
      svc.findAllPaginated({
        page: 1,
        limit: 20,
        sort_by: ProductSortField.NAME,
        sort_order: SortOrder.ASC,
        include_deleted: false,
        ...query,
      } as never),
    ),
    TestLayer,
  );

describe('ProductsService findAllPaginated filter matrix', () => {
  it('combines category, supplier, active, perishable, and price range filters', async () => {
    const wine = await seedCategory(db, { name: 'Wine' });
    const spirits = await seedCategory(db, { name: 'Spirits' });
    const supplierA = await seedSupplier(db, { name: 'Supplier A' });
    const supplierB = await seedSupplier(db, { name: 'Supplier B' });

    const target = await seedProduct(db, {
      category_id: wine.id,
      primary_supplier_id: supplierA.id,
      sku: 'MATRIX-TARGET',
      name: 'Filtered Champagne',
      standard_price: 25,
      is_active: true,
      is_perishable: true,
    });
    await seedProduct(db, {
      category_id: spirits.id,
      primary_supplier_id: supplierA.id,
      sku: 'MATRIX-CATEGORY',
      name: 'Wrong Category',
      standard_price: 25,
      is_active: true,
      is_perishable: true,
    });
    await seedProduct(db, {
      category_id: wine.id,
      primary_supplier_id: supplierB.id,
      sku: 'MATRIX-SUPPLIER',
      name: 'Wrong Supplier',
      standard_price: 25,
      is_active: true,
      is_perishable: true,
    });
    await seedProduct(db, {
      category_id: wine.id,
      primary_supplier_id: supplierA.id,
      sku: 'MATRIX-PRICE',
      name: 'Wrong Price',
      standard_price: 50,
      is_active: true,
      is_perishable: true,
    });

    const result = await listProducts({
      category_id: wine.id,
      primary_supplier_id: supplierA.id,
      is_active: true,
      is_perishable: true,
      min_price: 20,
      max_price: 30,
    });

    expect(result.meta.total).toBe(1);
    expect(result.data.map((product) => product.id)).toEqual([target.id]);
  });

  it('searches by name or SKU and excludes deleted products unless requested', async () => {
    const category = await seedCategory(db);
    const active = await seedProduct(db, {
      category_id: category.id,
      sku: 'CHAMP-ACTIVE',
      name: 'Champagne Active',
    });
    const deleted = await seedProduct(db, {
      category_id: category.id,
      sku: 'CHAMP-DELETED',
      name: 'Champagne Deleted',
      deleted_at: new Date('2026-05-24T08:00:00.000Z'),
      deleted_by: TEST_USER_ID,
    });
    await seedProduct(db, {
      category_id: category.id,
      sku: 'BEER-001',
      name: 'Beer',
    });

    const defaultResult = await listProducts({ search: 'CHAMP' });
    expect(defaultResult.data.map((product) => product.id)).toEqual([
      active.id,
    ]);

    const includeDeletedResult = await listProducts({
      search: 'CHAMP',
      include_deleted: true,
      sort_by: ProductSortField.SKU,
      sort_order: SortOrder.ASC,
    });
    expect(includeDeletedResult.meta.total).toBe(2);
    expect(includeDeletedResult.data.map((product) => product.id)).toEqual([
      active.id,
      deleted.id,
    ]);
  });

  it('sorts and paginates by standard price', async () => {
    const category = await seedCategory(db);
    await seedProduct(db, {
      category_id: category.id,
      sku: 'PRICE-LOW',
      name: 'Low Price',
      standard_price: 10,
    });
    const middle = await seedProduct(db, {
      category_id: category.id,
      sku: 'PRICE-MIDDLE',
      name: 'Middle Price',
      standard_price: 20,
    });
    const high = await seedProduct(db, {
      category_id: category.id,
      sku: 'PRICE-HIGH',
      name: 'High Price',
      standard_price: 30,
    });

    const result = await listProducts({
      page: 1,
      limit: 2,
      sort_by: ProductSortField.STANDARD_PRICE,
      sort_order: SortOrder.DESC,
    });

    expect(result.meta).toMatchObject({
      total: 3,
      page: 1,
      limit: 2,
      total_pages: 2,
    });
    expect(result.data.map((product) => product.id)).toEqual([
      high.id,
      middle.id,
    ]);
  });
});
