/**
 * Reference implementation for Effect-native tests.
 *
 * Patterns demonstrated here:
 *
 * 1. makeTestLayer — creates a typed mock layer where unimplemented methods
 *    die loudly (Effect.die) instead of returning undefined silently.
 *
 * 2. it.effect — runs the test body as an Effect fiber; no Effect.runPromise
 *    escape needed. Failures surface as test failures automatically.
 *
 * 3. Layers are provided inline per-test. Each it.effect body composes its
 *    own layer graph, so tests are fully isolated with no shared mutable state.
 *
 * 4. The *Methods objects (defaultRepoMethods, defaultCatMethods) hold the
 *    plain service implementations so individual tests can spread-and-override
 *    them before passing to makeTestLayer.
 */
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import { makeTestLayer } from '../../testing/utils';
import { CategoryNotFound as CanonicalCategoryNotFound } from '../categories/categories.errors';
import { CategoriesService } from '../categories/service';
import { SupplierNotFound } from '../suppliers/suppliers.errors';
import { SuppliersService } from '../suppliers/service';
import { ProductsRepository } from './repository';
import { ProductsInfrastructureError } from './products.errors';
import { ProductsService } from './service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeProductEntity = (overrides: Record<string, any> = {}) => ({
  id: 'prod-1',
  tenant_id: '00000000-0000-4000-8000-000000000001',
  sku: 'SKU-001',
  name: 'Widget',
  description: null,
  category_id: 'cat-1',
  volume_ml: null,
  weight_kg: null,
  dimensions_cm: null,
  standard_cost: 10,
  standard_price: 20,
  markup_percentage: null,
  reorder_point: 5,
  primary_supplier_id: null,
  supplier_sku: null,
  barcode: null,
  unit: null,
  is_active: true,
  is_perishable: false,
  notes: null,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-01'),
  deleted_at: null,
  created_by: null,
  updated_by: null,
  deleted_by: null,
  category: {
    id: 'cat-1',
    tenant_id: '00000000-0000-4000-8000-000000000001',
    name: 'Electronics',
    description: null,
    parent_id: null,
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  },
  primary_supplier: null,
  ...overrides,
});

const defaultPaginatedResult = {
  data: [makeProductEntity()],
  total: 1,
  page: 1,
  limit: 20,
  total_pages: 1,
};

// ---------------------------------------------------------------------------
// Default method objects — spread-and-override these per test
// ---------------------------------------------------------------------------

const defaultRepoMethods: Partial<ProductsRepository> = {
  findAllPaginated: () => Effect.succeed(defaultPaginatedResult),
  findAll: () => Effect.succeed([makeProductEntity()]),
  findById: () => Effect.succeed(makeProductEntity()),
  findBySku: () => Effect.succeed(null),
  findBySkus: () => Effect.succeed([]),
  findByCategoryId: () => Effect.succeed([makeProductEntity()]),
  findByCategoryIds: () => Effect.succeed([makeProductEntity()]),
  findByIds: () => Effect.succeed([makeProductEntity()]),
  findDeletedByIds: () =>
    Effect.succeed([makeProductEntity({ deleted_at: new Date() })]),
  existsById: () => Effect.succeed(true),
  create: () => Effect.succeed(makeProductEntity()),
  update: () => Effect.succeed(makeProductEntity()),
  updateMany: () => Effect.succeed(['prod-1']),
  softDelete: () => Effect.void,
  archive: () => Effect.succeed(undefined),
  softDeleteMany: () => Effect.succeed(['prod-1']),
  restore: () => Effect.void,
  restoreMany: () => Effect.succeed(['prod-1']),
  hardDelete: () => Effect.void,
  hardDeleteMany: () => Effect.succeed(['prod-1']),
};

const defaultCatMethods: Partial<CategoriesService> = {
  existsById: () => Effect.succeed(true),
  ensureExistByIds: () => Effect.void,
  findAllDescendantIds: () => Effect.succeed(['child-1']),
};

const defaultSupplierMethods: Partial<SuppliersService> = {
  existsById: () => Effect.succeed(true),
  ensureExistByIds: () => Effect.void,
};

const makeSkuUniqueViolation = () =>
  new ProductsInfrastructureError({
    action: 'create product',
    cause: { code: '23505', constraint: 'products_tenant_sku_unique' },
    messageKey: 'products.repositoryFailed',
  });

// ---------------------------------------------------------------------------
// Layer helpers
// ---------------------------------------------------------------------------

const repoLayer = (overrides: Partial<ProductsRepository> = {}) =>
  makeTestLayer(ProductsRepository)({ ...defaultRepoMethods, ...overrides });

const catLayer = (overrides: Partial<CategoriesService> = {}) =>
  makeTestLayer(CategoriesService)({ ...defaultCatMethods, ...overrides });

const supplierLayer = (overrides: Partial<SuppliersService> = {}) =>
  makeTestLayer(SuppliersService)({
    ...defaultSupplierMethods,
    ...overrides,
  });

const serviceLayer = (
  repo = repoLayer(),
  cat = catLayer(),
  suppliers = supplierLayer(),
) =>
  ProductsService.DefaultWithoutDependencies.pipe(
    Layer.provide(Layer.mergeAll(repo, cat, suppliers)),
  );

const withService = <A, E>(
  effect: (svc: ProductsService) => Effect.Effect<A, E>,
  repo?: Partial<ProductsRepository>,
  cat?: Partial<CategoriesService>,
  suppliers?: Partial<SuppliersService>,
) =>
  Effect.gen(function* () {
    const svc = yield* ProductsService;
    return yield* effect(svc);
  }).pipe(
    Effect.provide(
      serviceLayer(repoLayer(repo), catLayer(cat), supplierLayer(suppliers)),
    ),
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProductsService', () => {
  describe('findAllPaginated', () => {
    it.effect('returns paginated products', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.findAllPaginated({
            page: 1,
            limit: 20,
          } as any);
          expect(result.data).toHaveLength(1);
          expect(result.meta).toMatchObject({ page: 1, total: 1 });
        }),
      ),
    );
  });

  describe('findAll', () => {
    it.effect('returns all products', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.findAll();
          expect(result).toHaveLength(1);
        }),
      ),
    );
  });

  describe('findOne', () => {
    it.effect('returns a product', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.findOne('prod-1', false);
          expect(result).toMatchObject({ id: 'prod-1', sku: 'SKU-001' });
        }),
      ),
    );

    it.effect('fails with ProductNotFound when repo returns null', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(svc.findOne('missing', false));
            expect(error).toMatchObject({ _tag: 'ProductNotFound' });
          }),
        { findById: () => Effect.succeed(null) },
      ),
    );
  });

  describe('findByCategory', () => {
    it.effect('returns products by category', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.findByCategory('cat-1');
          expect(result).toHaveLength(1);
        }),
      ),
    );

    it.effect('fails when category does not exist', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(svc.findByCategory('missing'));
            expect(error).toMatchObject({ _tag: 'CategoryNotFound' });
          }),
        undefined,
        { existsById: () => Effect.succeed(false) },
      ),
    );
  });

  describe('findByCategoryTree', () => {
    it.effect('returns products from category tree', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.findByCategoryTree('cat-1');
          expect(result).toHaveLength(1);
        }),
      ),
    );
  });

  describe('create', () => {
    const baseDto = {
      sku: 'SKU-001',
      name: 'Widget',
      category_id: 'cat-1',
      reorder_point: 5,
      is_active: true,
      is_perishable: false,
    } as any;

    it.effect('creates a product', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.create(baseDto, undefined);
          expect(result).toMatchObject({ id: 'prod-1' });
        }),
      ),
    );

    it.effect('fails when category does not exist', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(
              svc.create({ ...baseDto, category_id: 'missing' }, undefined),
            );
            expect(error).toMatchObject({ _tag: 'CategoryNotFound' });
          }),
        undefined,
        { existsById: () => Effect.succeed(false) },
      ),
    );

    it.effect('fails when SKU already exists', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(svc.create(baseDto, undefined));
            expect(error).toMatchObject({ _tag: 'SkuAlreadyExists' });
          }),
        { findBySku: () => Effect.succeed(makeProductEntity()) },
      ),
    );

    it.effect('maps SKU unique insert failures to SkuAlreadyExists', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const error = yield* Effect.flip(svc.create(baseDto, undefined));
            expect(error).toMatchObject({ _tag: 'SkuAlreadyExists' });
          }),
        {
          create: () => Effect.fail(makeSkuUniqueViolation()),
        },
      ),
    );

    it.effect('fails when price is below cost', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(
            svc.create(
              { ...baseDto, standard_cost: 100, standard_price: 50 },
              undefined,
            ),
          );
          expect(error).toMatchObject({ _tag: 'PriceBelowCost' });
        }),
      ),
    );
  });

  describe('update', () => {
    it.effect('updates a product', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.update(
            'prod-1',
            { name: 'Updated' } as any,
            undefined,
          );
          expect(result).toMatchObject({ id: 'prod-1' });
        }),
      ),
    );

    it.effect('skips repo.update when dto is empty', () => {
      let updateCalled = false;
      return withService(
        (svc) =>
          Effect.gen(function* () {
            yield* svc.update('prod-1', {} as any, undefined);
            expect(updateCalled).toBe(false);
          }),
        {
          update: () => {
            updateCalled = true;
            return Effect.succeed(makeProductEntity());
          },
        },
      );
    });
  });

  describe('delete', () => {
    it.effect('soft deletes by default', () => {
      let softDeleteCalled = false;
      return withService(
        (svc) =>
          Effect.gen(function* () {
            yield* svc.delete('prod-1', undefined, false);
            expect(softDeleteCalled).toBe(true);
          }),
        {
          softDelete: () => {
            softDeleteCalled = true;
            return Effect.void;
          },
        },
      );
    });

    it.effect('hard deletes when permanent=true', () => {
      let hardDeleteCalled = false;
      return withService(
        (svc) =>
          Effect.gen(function* () {
            yield* svc.delete('prod-1', 'user-1', true);
            expect(hardDeleteCalled).toBe(true);
          }),
        {
          hardDelete: () => {
            hardDeleteCalled = true;
            return Effect.void;
          },
        },
      );
    });
  });

  describe('restore', () => {
    it.effect('restores a deleted product', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.restore('prod-1');
            expect(result).toMatchObject({ id: 'prod-1' });
          }),
        {
          findById: () =>
            Effect.succeed(makeProductEntity({ deleted_at: new Date() })),
        },
      ),
    );

    it.effect('fails when product is not deleted', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(svc.restore('prod-1'));
          expect(error).toMatchObject({ _tag: 'ProductNotDeleted' });
        }),
      ),
    );
  });

  describe('bulkCreate', () => {
    const singleProduct = {
      sku: 'SKU-A',
      name: 'A',
      category_id: 'cat-1',
      reorder_point: 1,
      is_active: true,
      is_perishable: false,
    } as any;

    it.effect('creates products in bulk', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.bulkCreate(
            { products: [singleProduct] },
            undefined,
          );
          expect(result.success_count).toBe(1);
        }),
      ),
    );

    it.effect('records failure when category is missing', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkCreate(
              { products: [{ ...singleProduct, category_id: 'missing' }] },
              undefined,
            );
            expect(result.failure_count).toBe(1);
          }),
        undefined,
        {
          ensureExistByIds: () =>
            Effect.fail(
              new CanonicalCategoryNotFound({
                id: 'missing',
                messageKey: 'categories.notFound',
              }),
            ),
        },
      ),
    );

    it.effect('records failure when supplier is missing', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkCreate(
              {
                products: [
                  { ...singleProduct, primary_supplier_id: 'missing' },
                ],
              },
              undefined,
            );
            expect(result.failure_count).toBe(1);
          }),
        undefined,
        undefined,
        {
          ensureExistByIds: () =>
            Effect.fail(
              new SupplierNotFound({
                id: 'missing',
                messageKey: 'suppliers.notFound',
              }),
            ),
        },
      ),
    );

    it.effect('rejects duplicate SKUs within the request', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.bulkCreate(
            { products: [singleProduct, { ...singleProduct, name: 'B' }] },
            undefined,
          );
          expect(result.failure_count).toBe(2);
        }),
      ),
    );

    it.effect('records price-below-cost products as row failures', () => {
      let createCalled = false;
      return withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkCreate(
              {
                products: [
                  {
                    ...singleProduct,
                    standard_cost: 100,
                    standard_price: 50,
                  },
                ],
              },
              undefined,
            );
            expect(result.success_count).toBe(0);
            expect(result.failure_count).toBe(1);
            expect(result.failures[0]).toMatchObject({ sku: 'SKU-A' });
            expect(createCalled).toBe(false);
          }),
        {
          create: () => {
            createCalled = true;
            return Effect.succeed(makeProductEntity());
          },
        },
      );
    });

    it.effect('checks existing SKUs in one batch lookup', () => {
      let findBySkuCalled = false;
      let findBySkusInput: readonly string[] = [];
      return withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkCreate(
              { products: [singleProduct] },
              undefined,
            );
            expect(result.success_count).toBe(0);
            expect(result.failure_count).toBe(1);
            expect(result.failures[0]).toMatchObject({ sku: 'SKU-A' });
            expect(findBySkusInput).toEqual(['SKU-A']);
            expect(findBySkuCalled).toBe(false);
          }),
        {
          findBySku: () => {
            findBySkuCalled = true;
            return Effect.succeed(null);
          },
          findBySkus: (skus) => {
            findBySkusInput = skus;
            return Effect.succeed([makeProductEntity({ sku: 'SKU-A' })]);
          },
        },
      );
    });

    it.effect('records SKU unique insert failures and continues', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkCreate(
              {
                products: [
                  singleProduct,
                  { ...singleProduct, sku: 'SKU-B', name: 'B' },
                ],
              },
              undefined,
            );
            expect(result.success_count).toBe(1);
            expect(result.failure_count).toBe(1);
            expect(result.succeeded).toEqual(['prod-b']);
            expect(result.failures[0]).toMatchObject({ sku: 'SKU-A' });
          }),
        {
          create: (data) =>
            data.sku === 'SKU-A'
              ? Effect.fail(makeSkuUniqueViolation())
              : Effect.succeed(makeProductEntity({ id: 'prod-b' })),
        },
      ),
    );
  });

  describe('bulkUpdateStatus', () => {
    it.effect('updates status in bulk', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.bulkUpdateStatus(
            { ids: ['prod-1'], is_active: false },
            undefined,
          );
          expect(result.success_count).toBe(1);
        }),
      ),
    );

    it.effect('records not-found products as failures', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkUpdateStatus(
              { ids: ['missing'], is_active: false },
              undefined,
            );
            expect(result.failure_count).toBe(1);
          }),
        { findByIds: () => Effect.succeed([]) },
      ),
    );

    it.effect('reports the ids returned by the update', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkUpdateStatus(
              { ids: ['prod-1', 'prod-2'], is_active: false },
              undefined,
            );
            expect(result.success_count).toBe(1);
            expect(result.succeeded).toEqual(['prod-2']);
          }),
        {
          findByIds: () =>
            Effect.succeed([
              makeProductEntity({ id: 'prod-1' }),
              makeProductEntity({ id: 'prod-2' }),
            ]),
          updateMany: () => Effect.succeed(['prod-2']),
        },
      ),
    );
  });

  describe('bulkDelete', () => {
    it.effect('soft deletes in bulk', () => {
      let softDeleteManyCalled = false;
      return withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkDelete(
              { ids: ['prod-1'], permanent: false },
              undefined,
            );
            expect(result.success_count).toBe(1);
            expect(softDeleteManyCalled).toBe(true);
          }),
        {
          softDeleteMany: () => {
            softDeleteManyCalled = true;
            return Effect.succeed(['prod-1']);
          },
        },
      );
    });

    it.effect('hard deletes in bulk when permanent=true', () => {
      let hardDeleteManyCalled = false;
      return withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkDelete(
              { ids: ['prod-1'], permanent: true },
              undefined,
            );
            expect(result.success_count).toBe(1);
            expect(hardDeleteManyCalled).toBe(true);
          }),
        {
          hardDeleteMany: () => {
            hardDeleteManyCalled = true;
            return Effect.succeed(['prod-1']);
          },
        },
      );
    });

    it.effect('reports the ids returned by the delete', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkDelete(
              { ids: ['prod-1', 'prod-2'], permanent: false },
              undefined,
            );
            expect(result.success_count).toBe(1);
            expect(result.succeeded).toEqual(['prod-2']);
          }),
        {
          findByIds: () =>
            Effect.succeed([
              makeProductEntity({ id: 'prod-1' }),
              makeProductEntity({ id: 'prod-2' }),
            ]),
          softDeleteMany: () => Effect.succeed(['prod-2']),
        },
      ),
    );
  });

  describe('archive', () => {
    it.effect(
      'delegates the expected version and actor to the repository',
      () => {
        const expectedUpdatedAt = new Date('2026-01-01T00:00:00.000Z');
        let received: readonly [string, string, Date] | undefined;

        return withService(
          (svc) =>
            Effect.gen(function* () {
              yield* svc.archive('prod-1', 'user-1', expectedUpdatedAt);
              expect(received).toEqual(['prod-1', 'user-1', expectedUpdatedAt]);
            }),
          {
            archive: (id, userId, version) => {
              received = [id, userId, version];
              return Effect.succeed(undefined);
            },
          },
        );
      },
    );
  });

  describe('bulkRestore', () => {
    it.effect('restores deleted products', () =>
      withService((svc) =>
        Effect.gen(function* () {
          const result = yield* svc.bulkRestore({ ids: ['prod-1'] });
          expect(result.success_count).toBe(1);
        }),
      ),
    );

    it.effect('records not-deleted products as failures', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkRestore({ ids: ['prod-1'] });
            expect(result.failure_count).toBe(1);
          }),
        { findDeletedByIds: () => Effect.succeed([]) },
      ),
    );

    it.effect('reports the ids returned by the restore', () =>
      withService(
        (svc) =>
          Effect.gen(function* () {
            const result = yield* svc.bulkRestore({
              ids: ['prod-1', 'prod-2'],
            });
            expect(result.success_count).toBe(1);
            expect(result.succeeded).toEqual(['prod-2']);
          }),
        {
          findDeletedByIds: () =>
            Effect.succeed([
              makeProductEntity({ id: 'prod-1', deleted_at: new Date() }),
              makeProductEntity({ id: 'prod-2', deleted_at: new Date() }),
            ]),
          restoreMany: () => Effect.succeed(['prod-2']),
        },
      ),
    );
  });
});
