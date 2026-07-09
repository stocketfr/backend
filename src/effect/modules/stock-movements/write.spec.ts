import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { StockMovementReason } from '@stocket/types/stock-movements';
import {
  makeStockMovementWriteWorkflows,
  type StockMovementWriteRepository,
} from './write';
import type {
  StockMovementCreateValues,
  StockMovementRow,
  StockMovementWithRelations,
} from './types';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-03-01T00:00:00.000Z');

const makeStockMovementRow = (
  overrides: Partial<StockMovementRow> = {},
): StockMovementRow => ({
  id: 'stock-movement-1',
  tenant_id: tenantId,
  product_id: 'product-1',
  from_location_id: 'location-1',
  to_location_id: 'location-2',
  quantity: 3,
  reason: StockMovementReason.INTERNAL_TRANSFER,
  order_id: null,
  reference_number: 'REF-1',
  cost_per_unit: 12.5,
  kanban_task_id: null,
  user_id: 'user-1',
  notes: 'Transfer',
  created_at: now,
  ...overrides,
});

const makeStockMovementWithRelations = (
  overrides: Partial<StockMovementWithRelations> = {},
): StockMovementWithRelations => ({
  ...makeStockMovementRow(),
  product: {
    id: 'product-1',
    name: 'Orange Juice',
    sku: 'OJ-001',
  },
  fromLocation: {
    id: 'location-1',
    name: 'Warehouse A',
  },
  toLocation: {
    id: 'location-2',
    name: 'Store B',
  },
  ...overrides,
});

type ProductExists = (productId: string) => Effect.Effect<boolean>;
type LocationExists = (locationId: string) => Effect.Effect<boolean>;

const makeRepository = (
  overrides: Partial<StockMovementWriteRepository> = {},
): StockMovementWriteRepository => ({
  create: (values) =>
    Effect.succeed(
      makeStockMovementRow({
        ...values,
      }),
    ),
  findById: () => Effect.succeed(makeStockMovementWithRelations()),
  orderExistsById: () => Effect.succeed(true),
  ...overrides,
});

describe('makeStockMovementWriteWorkflows', () => {
  it.effect('validates references, creates, reloads relations, and returns a DTO', () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      let capturedCreate: StockMovementCreateValues | undefined;
      const repository = makeRepository({
        create: (values) =>
          Effect.sync(() => {
            calls.push('create');
            capturedCreate = values;
            return makeStockMovementRow({
              id: 'stock-movement-created',
              ...values,
            });
          }),
        findById: (id) =>
          Effect.sync(() => {
            calls.push(`find:${id}`);
            return makeStockMovementWithRelations({
              id,
              quantity: 4,
              order_id: 'order-1',
            });
          }),
        orderExistsById: (orderId) =>
          Effect.sync(() => {
            calls.push(`order:${orderId}`);
            return true;
          }),
      });
      const productExists: ProductExists = (productId) =>
        Effect.sync(() => {
          calls.push(`product:${productId}`);
          return true;
        });
      const locationExists: LocationExists = (locationId) =>
        Effect.sync(() => {
          calls.push(`location:${locationId}`);
          return true;
        });
      const workflows = makeStockMovementWriteWorkflows({
        repository,
        productExists,
        locationExists,
      });

      const result = yield* workflows.create(
        {
          product_id: 'product-1',
          from_location_id: 'location-1',
          to_location_id: 'location-2',
          quantity: 4,
          reason: StockMovementReason.INTERNAL_TRANSFER,
          order_id: 'order-1',
          reference_number: 'REF-1',
          cost_per_unit: 12.5,
          notes: 'Transfer',
        },
        'user-1',
      );

      expect(capturedCreate).toEqual({
        product_id: 'product-1',
        from_location_id: 'location-1',
        to_location_id: 'location-2',
        quantity: 4,
        reason: StockMovementReason.INTERNAL_TRANSFER,
        order_id: 'order-1',
        reference_number: 'REF-1',
        cost_per_unit: 12.5,
        notes: 'Transfer',
        user_id: 'user-1',
      });
      expect(calls).toEqual([
        'product:product-1',
        'location:location-1',
        'location:location-2',
        'order:order-1',
        'create',
        'find:stock-movement-created',
      ]);
      expect(result).toMatchObject({
        id: 'stock-movement-created',
        product_id: 'product-1',
        quantity: 4,
      });
    }),
  );

  it.effect('writes nullable optional references for a minimal create DTO', () =>
    Effect.gen(function* () {
      let capturedCreate: StockMovementCreateValues | undefined;
      let locationCheckCalled = false;
      let orderCheckCalled = false;
      const workflows = makeStockMovementWriteWorkflows({
        repository: makeRepository({
          create: (values) =>
            Effect.sync(() => {
              capturedCreate = values;
              return makeStockMovementRow(values);
            }),
          orderExistsById: () =>
            Effect.sync(() => {
              orderCheckCalled = true;
              return true;
            }),
        }),
        productExists: () => Effect.succeed(true),
        locationExists: () =>
          Effect.sync(() => {
            locationCheckCalled = true;
            return true;
          }),
      });

      yield* workflows.create(
        {
          product_id: 'product-1',
          quantity: 1,
          reason: StockMovementReason.COUNT_CORRECTION,
        },
        'user-1',
      );

      expect(capturedCreate).toMatchObject({
        from_location_id: null,
        to_location_id: null,
        order_id: null,
        reference_number: null,
        cost_per_unit: null,
        notes: null,
      });
      expect(locationCheckCalled).toBe(false);
      expect(orderCheckCalled).toBe(false);
    }),
  );

  it.effect('fails before writing when the product does not exist', () =>
    Effect.gen(function* () {
      let createCalled = false;
      const workflows = makeStockMovementWriteWorkflows({
        repository: makeRepository({
          create: () =>
            Effect.sync(() => {
              createCalled = true;
              return makeStockMovementRow();
            }),
        }),
        productExists: () => Effect.succeed(false),
        locationExists: () => Effect.succeed(true),
      });

      const error = yield* Effect.flip(
        workflows.create(
          {
            product_id: 'missing-product',
            quantity: 1,
            reason: StockMovementReason.COUNT_CORRECTION,
          },
          'user-1',
        ),
      );

      expect(error).toMatchObject({
        _tag: 'InvalidStockMovementProduct',
        productId: 'missing-product',
      });
      expect(createCalled).toBe(false);
    }),
  );

  it.effect('uses source and destination specific errors for missing locations', () =>
    Effect.gen(function* () {
      const sourceMissing = makeStockMovementWriteWorkflows({
        repository: makeRepository(),
        productExists: () => Effect.succeed(true),
        locationExists: (locationId) =>
          Effect.succeed(locationId !== 'missing-source'),
      });
      const destinationMissing = makeStockMovementWriteWorkflows({
        repository: makeRepository(),
        productExists: () => Effect.succeed(true),
        locationExists: (locationId) =>
          Effect.succeed(locationId !== 'missing-destination'),
      });

      const sourceError = yield* Effect.flip(
        sourceMissing.create(
          {
            product_id: 'product-1',
            from_location_id: 'missing-source',
            quantity: 1,
            reason: StockMovementReason.INTERNAL_TRANSFER,
          },
          'user-1',
        ),
      );
      const destinationError = yield* Effect.flip(
        destinationMissing.create(
          {
            product_id: 'product-1',
            to_location_id: 'missing-destination',
            quantity: 1,
            reason: StockMovementReason.INTERNAL_TRANSFER,
          },
          'user-1',
        ),
      );

      expect(sourceError).toMatchObject({
        _tag: 'InvalidSourceLocation',
        locationId: 'missing-source',
      });
      expect(destinationError).toMatchObject({
        _tag: 'InvalidDestinationLocation',
        locationId: 'missing-destination',
      });
    }),
  );

  it.effect('fails before writing when the order does not belong to the tenant', () =>
    Effect.gen(function* () {
      let createCalled = false;
      const workflows = makeStockMovementWriteWorkflows({
        repository: makeRepository({
          orderExistsById: () => Effect.succeed(false),
          create: () =>
            Effect.sync(() => {
              createCalled = true;
              return makeStockMovementRow();
            }),
        }),
        productExists: () => Effect.succeed(true),
        locationExists: () => Effect.succeed(true),
      });

      const error = yield* Effect.flip(
        workflows.create(
          {
            product_id: 'product-1',
            quantity: 1,
            reason: StockMovementReason.SALE,
            order_id: 'missing-order',
          },
          'user-1',
        ),
      );

      expect(error).toMatchObject({
        _tag: 'InvalidStockMovementOrder',
        orderId: 'missing-order',
      });
      expect(createCalled).toBe(false);
    }),
  );

  it.effect('fails if the created stock movement cannot be reloaded', () =>
    Effect.gen(function* () {
      const workflows = makeStockMovementWriteWorkflows({
        repository: makeRepository({
          create: () =>
            Effect.succeed(
              makeStockMovementRow({ id: 'stock-movement-created' }),
            ),
          findById: () => Effect.succeed(null),
        }),
        productExists: () => Effect.succeed(true),
        locationExists: () => Effect.succeed(true),
      });

      const error = yield* Effect.flip(
        workflows.create(
          {
            product_id: 'product-1',
            quantity: 1,
            reason: StockMovementReason.COUNT_CORRECTION,
          },
          'user-1',
        ),
      );

      expect(error).toMatchObject({
        _tag: 'StockMovementNotFound',
        id: 'stock-movement-created',
      });
    }),
  );
});
