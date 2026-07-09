import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  makeProductWriteWorkflows,
  type ProductWriteRepository,
} from './write';
import type { CreateProductDto, UpdateProductDto } from './types';
import { ProductsInfrastructureError } from './products.errors';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const CATEGORY_ID = '10000000-0000-4000-8000-000000000001';

type ProductEntity = NonNullable<
  Effect.Effect.Success<ReturnType<ProductWriteRepository['findById']>>
>;
type ProductCreateData = Parameters<ProductWriteRepository['create']>[0];
type ProductUpdateData = Parameters<ProductWriteRepository['update']>[1];

const createDto: CreateProductDto = {
  sku: 'SKU-001',
  name: 'Widget',
  category_id: CATEGORY_ID,
  reorder_point: 5,
  is_active: true,
  is_perishable: false,
};

const makeProduct = (
  overrides: Partial<ProductEntity> = {},
): ProductEntity => ({
  id: 'prod-1',
  tenant_id: TENANT_ID,
  sku: 'SKU-001',
  name: 'Widget',
  description: null,
  category_id: CATEGORY_ID,
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
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  deleted_at: null,
  created_by: null,
  updated_by: null,
  deleted_by: null,
  category: {
    id: CATEGORY_ID,
    tenant_id: TENANT_ID,
    name: 'Category',
    parent_id: null,
    description: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  },
  primary_supplier: null,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<ProductWriteRepository> = {},
): ProductWriteRepository => ({
  findBySku: () => Effect.succeed(null),
  create: () => Effect.succeed(makeProduct()),
  findById: () => Effect.succeed(makeProduct()),
  update: () => Effect.succeed(makeProduct()),
  ...overrides,
});

const makeWorkflows = (
  repository: ProductWriteRepository,
  validateProductTenantReferences = () => Effect.void,
  getProductOrFail = (id: string) => Effect.succeed(makeProduct({ id })),
) =>
  makeProductWriteWorkflows({
    repository,
    validateProductTenantReferences,
    getProductOrFail,
  });

const makeSkuUniqueViolation = () =>
  new ProductsInfrastructureError({
    action: 'write product',
    cause: { code: '23505', constraint: 'products_tenant_sku_unique' },
    messageKey: 'products.repositoryFailed',
  });

describe('makeProductWriteWorkflows', () => {
  describe('create', () => {
    it.effect('validates references, creates the row, and reloads relations', () =>
      Effect.gen(function* () {
        let validated = 0;
        let capturedCreate: ProductCreateData | undefined;
        const repository = makeRepository({
          create: (data) =>
            Effect.sync(() => {
              capturedCreate = data;
              return makeProduct({ id: 'created-product' });
            }),
          findById: (id) =>
            Effect.succeed(makeProduct({ id, created_by: 'user-1' })),
        });
        const workflows = makeWorkflows(repository, () =>
          Effect.sync(() => {
            validated++;
          }),
        );

        const result = yield* workflows.create(createDto, 'user-1');

        expect(validated).toBe(1);
        expect(capturedCreate).toMatchObject({
          sku: 'SKU-001',
          created_by: 'user-1',
          updated_by: 'user-1',
        });
        expect(result).toMatchObject({
          id: 'created-product',
          sku: 'SKU-001',
          created_by: 'user-1',
        });
      }),
    );

    it.effect('maps product SKU unique violations to the domain error', () =>
      Effect.gen(function* () {
        const repository = makeRepository({
          create: () => Effect.fail(makeSkuUniqueViolation()),
        });
        const workflows = makeWorkflows(repository);

        const error = yield* Effect.flip(workflows.create(createDto));

        expect(error).toMatchObject({
          _tag: 'SkuAlreadyExists',
          sku: 'SKU-001',
        });
      }),
    );
  });

  describe('update', () => {
    it.effect('patches defined fields and reloads the updated product', () =>
      Effect.gen(function* () {
        let current = makeProduct({ sku: 'OLD-SKU', name: 'Old Name' });
        let capturedUpdate: ProductUpdateData | undefined;
        let skuLookupCalled = false;
        const repository = makeRepository({
          findBySku: () =>
            Effect.sync(() => {
              skuLookupCalled = true;
              return null;
            }),
          update: (_id, data) =>
            Effect.sync(() => {
              capturedUpdate = data;
              current = makeProduct({ ...current, ...data });
              return current;
            }),
        });
        const workflows = makeWorkflows(
          repository,
          () => Effect.void,
          () => Effect.succeed(current),
        );
        const dto: UpdateProductDto = {
          sku: 'NEW-SKU',
          name: 'New Name',
        };

        const result = yield* workflows.update('prod-1', dto, 'user-2');

        expect(skuLookupCalled).toBe(true);
        expect(capturedUpdate).toMatchObject({
          sku: 'NEW-SKU',
          name: 'New Name',
          updated_by: 'user-2',
        });
        expect(result).toMatchObject({
          sku: 'NEW-SKU',
          name: 'New Name',
          updated_by: 'user-2',
        });
      }),
    );

    it.effect('returns the existing product without writing an empty patch', () =>
      Effect.gen(function* () {
        let updateCalled = false;
        const repository = makeRepository({
          update: () =>
            Effect.sync(() => {
              updateCalled = true;
              return makeProduct();
            }),
        });
        const workflows = makeWorkflows(repository);

        const result = yield* workflows.update('prod-1', {});

        expect(updateCalled).toBe(false);
        expect(result).toMatchObject({
          id: 'prod-1',
          sku: 'SKU-001',
        });
      }),
    );
  });
});
