import { Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { SortOrder } from '@stocket/types/common';
import { InventorySortField } from '@stocket/types/inventory';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import {
  seedCategory,
  seedProduct,
  seedLocation,
  seedArea,
  seedInventory,
} from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { InventoryService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<InventoryService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = InventoryService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, InventoryService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, InventoryService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

async function seedInventoryPrereqs() {
  const category = await seedCategory(db);
  const product = await seedProduct(db, { category_id: category.id });
  const location = await seedLocation(db);
  return { category, product, location };
}

describe('InventoryService Integration', () => {
  describe('create', () => {
    it('creates an inventory record with real references', async () => {
      const { product, location } = await seedInventoryPrereqs();

      const result = await run(
        Effect.flatMap(InventoryService, (svc) =>
          svc.create({
            product_id: product.id,
            location_id: location.id,
            quantity: 50,
            batchNumber: 'BATCH-001',
            cost_per_unit: 12.5,
          } as any),
        ),
      );

      expect(result.product_id).toBe(product.id);
      expect(result.location_id).toBe(location.id);
      expect(result.quantity).toBe(50);
    });

    it('creates inventory with an area and validates location match', async () => {
      const { product, location } = await seedInventoryPrereqs();
      const area = await seedArea(db, { location_id: location.id });

      const result = await run(
        Effect.flatMap(InventoryService, (svc) =>
          svc.create({
            product_id: product.id,
            location_id: location.id,
            area_id: area.id,
            quantity: 20,
          } as any),
        ),
      );

      expect(result.area_id).toBe(area.id);
    });

    it('rejects area that belongs to a different location', async () => {
      const { product, location } = await seedInventoryPrereqs();
      const otherLocation = await seedLocation(db);
      const area = await seedArea(db, { location_id: otherLocation.id });

      const error = await fail(
        Effect.flatMap(InventoryService, (svc) =>
          svc.create({
            product_id: product.id,
            location_id: location.id,
            area_id: area.id,
            quantity: 10,
          } as any),
        ),
      );

      expect(error._tag).toBe('InventoryAreaLocationMismatch');
    });

    it('rejects duplicate product+location+area combination', async () => {
      const { product, location } = await seedInventoryPrereqs();

      const error = await fail(
        Effect.flatMap(InventoryService, (svc) =>
          Effect.flatMap(
            svc.create({
              product_id: product.id,
              location_id: location.id,
              quantity: 10,
            } as any),
            () =>
              svc.create({
                product_id: product.id,
                location_id: location.id,
                quantity: 5,
              } as any),
          ),
        ),
      );

      expect(error._tag).toBe('InventoryAlreadyExists');
    });

    it('rejects nonexistent product', async () => {
      const location = await seedLocation(db);

      const error = await fail(
        Effect.flatMap(InventoryService, (svc) =>
          svc.create({
            product_id: '00000000-0000-0000-0000-000000000000',
            location_id: location.id,
            quantity: 10,
          } as any),
        ),
      );

      expect(error._tag).toBe('InvalidInventoryProduct');
    });
  });

  describe('adjustQuantity', () => {
    it('adjusts quantity up and down within bounds', async () => {
      const { product, location } = await seedInventoryPrereqs();
      await seedInventory(db, {
        product_id: product.id,
        location_id: location.id,
        quantity: 50,
      });

      const result = await run(
        Effect.flatMap(InventoryService, (svc) =>
          Effect.gen(function* () {
            const all = yield* svc.findByProduct(product.id, {
              page: 1,
              limit: 20,
            } as any);
            const inv = all.data[0]!;

            const after = yield* svc.adjustQuantity(inv.id, {
              adjustment: -20,
            } as any);
            expect(after.quantity).toBe(30);

            return yield* svc.adjustQuantity(inv.id, {
              adjustment: 10,
            } as any);
          }),
        ),
      );

      expect(result.quantity).toBe(40);
    });

    it('rejects adjustment that would go negative', async () => {
      const { product, location } = await seedInventoryPrereqs();
      await seedInventory(db, {
        product_id: product.id,
        location_id: location.id,
        quantity: 5,
      });

      const error = await fail(
        Effect.flatMap(InventoryService, (svc) =>
          Effect.gen(function* () {
            const all = yield* svc.findByProduct(product.id, {
              page: 1,
              limit: 20,
            } as any);
            return yield* svc.adjustQuantity(all.data[0]!.id, {
              adjustment: -10,
            } as any);
          }),
        ),
      );

      expect(error._tag).toBe('InventoryQuantityAdjustmentFailed');
    });
  });

  describe('findByProduct / findByLocation', () => {
    it('returns inventory records filtered by product', async () => {
      const { product, location } = await seedInventoryPrereqs();
      await seedInventory(db, {
        product_id: product.id,
        location_id: location.id,
        quantity: 30,
      });

      const result = await run(
        Effect.flatMap(InventoryService, (svc) =>
          svc.findByProduct(product.id, { page: 1, limit: 20 } as any),
        ),
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.product_id).toBe(product.id);
      expect(result.data[0]!.product).toMatchObject({ name: product.name });
      expect(result.data[0]!.location).toMatchObject({ name: location.name });
    });

    it('bounds a representative 125-row inventory tenant payload', async () => {
      const category = await seedCategory(db);
      const location = await seedLocation(db);
      for (let index = 0; index < 125; index += 1) {
        const product = await seedProduct(db, {
          category_id: category.id,
          sku: `INVENTORY-LARGE-${index.toString().padStart(3, '0')}`,
        });
        await seedInventory(db, {
          product_id: product.id,
          location_id: location.id,
          quantity: index,
        });
      }

      const result = await run(
        Effect.flatMap(InventoryService, (svc) =>
          svc.findAllPaginated({
            page: 1,
            limit: 100,
            sort_by: InventorySortField.QUANTITY,
            sort_order: SortOrder.ASC,
          }),
        ),
      );

      expect(result.meta).toMatchObject({
        total: 125,
        limit: 100,
        total_pages: 2,
      });
      expect(result.data).toHaveLength(100);
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
        256 * 1024,
      );
    });
  });

  describe('findSummary', () => {
    it('counts low-stock and expiring-soon inventory from real rows', async () => {
      const location = await seedLocation(db);
      const category = await seedCategory(db);
      const lowStockProduct = await seedProduct(db, {
        category_id: category.id,
        reorder_point: 10,
      });
      const healthyProduct = await seedProduct(db, {
        category_id: category.id,
        reorder_point: 5,
      });
      const futureProduct = await seedProduct(db, {
        category_id: category.id,
        reorder_point: 1,
      });

      await seedInventory(db, {
        product_id: lowStockProduct.id,
        location_id: location.id,
        quantity: 10,
        expiry_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });
      await seedInventory(db, {
        product_id: healthyProduct.id,
        location_id: location.id,
        quantity: 20,
        expiry_date: null,
      });
      await seedInventory(db, {
        product_id: futureProduct.id,
        location_id: location.id,
        quantity: 2,
        expiry_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });

      const result = await run(
        Effect.flatMap(InventoryService, (svc) => svc.findSummary()),
      );

      expect(result).toEqual({
        low_stock_count: 1,
        expiring_soon_count: 1,
      });
    });

    it('excludes inventory rows from other tenants', async () => {
      const location = await seedLocation(db);
      const category = await seedCategory(db);
      const product = await seedProduct(db, {
        category_id: category.id,
        reorder_point: 10,
      });
      await seedInventory(db, {
        product_id: product.id,
        location_id: location.id,
        quantity: 1,
        expiry_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });

      const otherTenantId = randomUUID();
      const otherCategory = await seedCategory(db, {
        tenant_id: otherTenantId,
      });
      const otherProduct = await seedProduct(db, {
        tenant_id: otherTenantId,
        category_id: otherCategory.id,
        reorder_point: 10,
      });
      const otherLocation = await seedLocation(db, {
        tenant_id: otherTenantId,
      });
      await seedInventory(db, {
        tenant_id: otherTenantId,
        product_id: otherProduct.id,
        location_id: otherLocation.id,
        quantity: 1,
        expiry_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });

      const result = await run(
        Effect.flatMap(InventoryService, (svc) => svc.findSummary()),
      );

      expect(result).toEqual({
        low_stock_count: 1,
        expiring_soon_count: 1,
      });
    });
  });

  describe('delete', () => {
    it('deletes an inventory record', async () => {
      const { product, location } = await seedInventoryPrereqs();
      await seedInventory(db, {
        product_id: product.id,
        location_id: location.id,
      });

      const error = await fail(
        Effect.flatMap(InventoryService, (svc) =>
          Effect.gen(function* () {
            const all = yield* svc.findByProduct(product.id, {
              page: 1,
              limit: 20,
            } as any);
            yield* svc.delete(all.data[0]!.id);
            return yield* svc.findOne(all.data[0]!.id);
          }),
        ),
      );

      expect(error._tag).toBe('InventoryNotFound');
    });
  });
});
