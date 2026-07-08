import { Effect, Layer } from 'effect';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import {
  seedCategory,
  seedProduct,
  seedSupplier,
  TEST_USER_ID,
} from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { ProductsService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<ProductsService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = ProductsService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, ProductsService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, ProductsService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

describe('ProductsService Integration', () => {
  describe('create', () => {
    it('creates a product with category reference', async () => {
      const category = await seedCategory(db);

      const result = await run(
        Effect.flatMap(ProductsService, (svc) =>
          svc.create({
            category_id: category.id,
            sku: 'WINE-001',
            name: 'Château Margaux 2020',
            standard_price: 250,
            standard_cost: 180,
          } as any, TEST_USER_ID),
        ),
      );

      expect(result.sku).toBe('WINE-001');
      expect(result.name).toBe('Château Margaux 2020');
      expect(result.category_id).toBe(category.id);
    });

    it('rejects duplicate SKU', async () => {
      const category = await seedCategory(db);
      await seedProduct(db, { category_id: category.id, sku: 'DUP-SKU' });

      const error = await fail(
        Effect.flatMap(ProductsService, (svc) =>
          svc.create({
            category_id: category.id,
            sku: 'DUP-SKU',
            name: 'Duplicate',
          } as any),
        ),
      );

      expect(error._tag).toBe('SkuAlreadyExists');
    });

    it('rejects SKU held by a soft-deleted product', async () => {
      const category = await seedCategory(db);
      await seedProduct(db, {
        category_id: category.id,
        sku: 'SOFT-DELETED-SKU',
        deleted_at: new Date('2026-01-01T00:00:00.000Z'),
        deleted_by: TEST_USER_ID,
      });

      const error = await fail(
        Effect.flatMap(ProductsService, (svc) =>
          svc.create({
            category_id: category.id,
            sku: 'SOFT-DELETED-SKU',
            name: 'Replacement',
          } as any),
        ),
      );

      expect(error._tag).toBe('SkuAlreadyExists');
    });

    it('maps concurrent duplicate SKU creates to SkuAlreadyExists', async () => {
      const category = await seedCategory(db);

      const results = await run(
        Effect.flatMap(ProductsService, (svc) =>
          Effect.all(
            [
              Effect.either(
                svc.create({
                  category_id: category.id,
                  sku: 'RACE-SKU',
                  name: 'Race A',
                } as any),
              ),
              Effect.either(
                svc.create({
                  category_id: category.id,
                  sku: 'RACE-SKU',
                  name: 'Race B',
                } as any),
              ),
            ],
            { concurrency: 2 },
          ),
        ),
      );

      const successCount = results.filter(
        (result) => result._tag === 'Right',
      ).length;
      const failureTags = results.flatMap((result) =>
        result._tag === 'Left' ? [result.left._tag] : [],
      );

      expect(successCount).toBe(1);
      expect(failureTags).toEqual(['SkuAlreadyExists']);
    });

    it('rejects price below cost', async () => {
      const category = await seedCategory(db);

      const error = await fail(
        Effect.flatMap(ProductsService, (svc) =>
          svc.create({
            category_id: category.id,
            sku: 'CHEAP-001',
            name: 'Bad Margin',
            standard_price: 10,
            standard_cost: 50,
          } as any),
        ),
      );

      expect(error._tag).toBe('PriceBelowCost');
    });

    it('rejects nonexistent category', async () => {
      const error = await fail(
        Effect.flatMap(ProductsService, (svc) =>
          svc.create({
            category_id: '00000000-0000-0000-0000-000000000000',
            sku: 'ORPHAN-001',
            name: 'Orphan Product',
          } as any),
        ),
      );

      expect(error._tag).toBe('CategoryNotFound');
    });
  });

  describe('findOne', () => {
    it('returns product with category and supplier relations', async () => {
      const category = await seedCategory(db, { name: 'Wines' });
      const supplier = await seedSupplier(db, { name: 'Bordeaux Imports' });
      await seedProduct(db, {
        category_id: category.id,
        primary_supplier_id: supplier.id,
        sku: 'REL-001',
        name: 'Related Product',
      });

      const result = await run(
        Effect.flatMap(ProductsService, (svc) =>
          Effect.flatMap(svc.findAll(), (all) => svc.findOne(all[0]!.id)),
        ),
      );

      expect(result.category).toMatchObject({ name: 'Wines' });
      expect(result.primary_supplier).toMatchObject({ name: 'Bordeaux Imports' });
    });

    it('fails for nonexistent product', async () => {
      const error = await fail(
        Effect.flatMap(ProductsService, (svc) =>
          svc.findOne('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('ProductNotFound');
    });
  });

  describe('update', () => {
    it('updates product fields', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });

      const result = await run(
        Effect.flatMap(ProductsService, (svc) =>
          svc.update(product.id, { name: 'Updated Name' } as any, TEST_USER_ID),
        ),
      );

      expect(result.name).toBe('Updated Name');
    });

    it('rejects SKU change to existing SKU', async () => {
      const category = await seedCategory(db);
      await seedProduct(db, { category_id: category.id, sku: 'TAKEN-SKU' });
      const product = await seedProduct(db, { category_id: category.id, sku: 'MY-SKU' });

      const error = await fail(
        Effect.flatMap(ProductsService, (svc) =>
          svc.update(product.id, { sku: 'TAKEN-SKU' } as any),
        ),
      );

      expect(error._tag).toBe('SkuAlreadyExists');
    });
  });

  describe('soft delete and restore', () => {
    it('soft-deletes and then restores a product', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });

      // Soft delete
      await run(
        Effect.flatMap(ProductsService, (svc) =>
          svc.delete(product.id, TEST_USER_ID, false),
        ),
      );

      // Should not appear in findAll (default excludes deleted)
      const allAfterDelete = await run(
        Effect.flatMap(ProductsService, (svc) => svc.findAll()),
      );
      expect(allAfterDelete.find((p: any) => p.id === product.id)).toBeUndefined();

      // Restore
      const restored = await run(
        Effect.flatMap(ProductsService, (svc) => svc.restore(product.id)),
      );

      expect(restored.id).toBe(product.id);

      // Should appear again
      const allAfterRestore = await run(
        Effect.flatMap(ProductsService, (svc) => svc.findAll()),
      );
      expect(allAfterRestore.find((p: any) => p.id === product.id)).toBeTruthy();
    });

    it('rejects restoring a non-deleted product', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });

      const error = await fail(
        Effect.flatMap(ProductsService, (svc) => svc.restore(product.id)),
      );

      expect(error._tag).toBe('ProductNotDeleted');
    });
  });

  describe('findByCategory and findByCategoryTree', () => {
    it('findByCategory returns products in a specific category', async () => {
      const catA = await seedCategory(db, { name: 'Category A' });
      const catB = await seedCategory(db, { name: 'Category B' });
      await seedProduct(db, { category_id: catA.id, name: 'In A' });
      await seedProduct(db, { category_id: catB.id, name: 'In B' });

      const result = await run(
        Effect.flatMap(ProductsService, (svc) => svc.findByCategory(catA.id)),
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('In A');
    });

    it('findByCategoryTree returns products from parent and child categories', async () => {
      const parent = await seedCategory(db, { name: 'Beverages' });
      const child = await seedCategory(db, { name: 'Wines', parent_id: parent.id });
      await seedProduct(db, { category_id: parent.id, name: 'Water' });
      await seedProduct(db, { category_id: child.id, name: 'Merlot' });

      const result = await run(
        Effect.flatMap(ProductsService, (svc) =>
          svc.findByCategoryTree(parent.id),
        ),
      );

      expect(result).toHaveLength(2);
      const names = result.map((p: any) => p.name).sort();
      expect(names).toEqual(['Merlot', 'Water']);
    });
  });

  describe('findAllPaginated', () => {
    it('paginates and filters by search term', async () => {
      const category = await seedCategory(db);
      await seedProduct(db, { category_id: category.id, name: 'Champagne Brut', sku: 'CH-001' });
      await seedProduct(db, { category_id: category.id, name: 'Red Wine', sku: 'RW-001' });
      await seedProduct(db, { category_id: category.id, name: 'Champagne Rosé', sku: 'CH-002' });

      const result = await run(
        Effect.flatMap(ProductsService, (svc) =>
          svc.findAllPaginated({ page: 1, limit: 10, search: 'Champagne', sort_by: 'name', sort_order: 'asc', include_deleted: false } as any),
        ),
      );

      expect(result.data).toHaveLength(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('existsById', () => {
    it('returns true for existing, false for missing', async () => {
      const category = await seedCategory(db);
      const product = await seedProduct(db, { category_id: category.id });

      const [exists, missing] = await run(
        Effect.flatMap(ProductsService, (svc) =>
          Effect.all([
            svc.existsById(product.id),
            svc.existsById('00000000-0000-0000-0000-000000000000'),
          ]),
        ),
      );

      expect(exists).toBe(true);
      expect(missing).toBe(false);
    });
  });
});
