import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import type { AreaResponseDto } from '@stocket/types/areas';
import type { InventoryWithRelations } from './repository';
import {
  makeInventoryWriteWorkflows,
  type InventoryWriteRepository,
} from './write';
import type {
  AdjustInventoryDto,
  CreateInventoryDto,
  UpdateInventoryDto,
} from './types';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const PRODUCT_ID = '10000000-0000-4000-8000-000000000001';
const LOCATION_ID = '20000000-0000-4000-8000-000000000001';
const NEXT_LOCATION_ID = '20000000-0000-4000-8000-000000000002';
const AREA_ID = '30000000-0000-4000-8000-000000000001';
const NEXT_AREA_ID = '30000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-01-01T00:00:00.000Z');

type InventoryCreateData = Parameters<InventoryWriteRepository['create']>[0];
type InventoryUpdateData = Parameters<InventoryWriteRepository['update']>[1];

const createDto: CreateInventoryDto = {
  product_id: PRODUCT_ID,
  location_id: LOCATION_ID,
  area_id: AREA_ID,
  quantity: 10,
  batchNumber: 'BATCH-NEW',
  expiry_date: new Date('2026-06-01T00:00:00.000Z'),
  cost_per_unit: 7.5,
  received_date: new Date('2026-01-15T00:00:00.000Z'),
};

const makeInventory = (
  overrides: Partial<InventoryWithRelations> = {},
): InventoryWithRelations => ({
  id: 'inventory-1',
  tenant_id: TENANT_ID,
  product_id: PRODUCT_ID,
  location_id: LOCATION_ID,
  area_id: null,
  quantity: 25,
  batch_number: 'BATCH-1',
  expiry_date: null,
  cost_per_unit: 9.5,
  received_date: null,
  created_at: NOW,
  updated_at: NOW,
  product: null,
  location: null,
  area: null,
  ...overrides,
});

const makeArea = (overrides: Partial<AreaResponseDto> = {}): AreaResponseDto => ({
  id: AREA_ID,
  location_id: LOCATION_ID,
  parent_id: null,
  name: 'Cold Storage',
  code: 'COLD',
  description: '',
  is_active: true,
  created_at: NOW,
  updated_at: NOW,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<InventoryWriteRepository> = {},
): InventoryWriteRepository => ({
  findByProductAndLocationWithRelations: () => Effect.succeed(null),
  create: () => Effect.succeed(makeInventory()),
  update: () => Effect.succeed(makeInventory()),
  adjustQuantity: () => Effect.succeed(1),
  delete: () => Effect.void,
  ...overrides,
});

const makeWorkflows = ({
  repository,
  area = makeArea(),
  ensureProductExists = () => Effect.void,
  ensureLocationExists = () => Effect.void,
  getInventoryOrFail = (id: string) => Effect.succeed(makeInventory({ id })),
}: {
  readonly repository: InventoryWriteRepository;
  readonly area?: AreaResponseDto;
  readonly ensureProductExists?: (
    productId: string,
  ) => Effect.Effect<void>;
  readonly ensureLocationExists?: (
    locationId: string,
  ) => Effect.Effect<void>;
  readonly getInventoryOrFail?: (
    id: string,
  ) => Effect.Effect<InventoryWithRelations>;
}) =>
  makeInventoryWriteWorkflows({
    repository,
    areasService: {
      findById: () => Effect.succeed(area),
    },
    ensureProductExists,
    ensureLocationExists,
    getInventoryOrFail,
  });

describe('makeInventoryWriteWorkflows', () => {
  it.effect('creates inventory after validating product, location, and area', () =>
    Effect.gen(function* () {
      let productValidated = 0;
      let locationValidated = 0;
      let capturedCreate: InventoryCreateData | undefined;
      const repository = makeRepository({
        create: (data) =>
          Effect.sync(() => {
            capturedCreate = data;
            return makeInventory({ id: 'inventory-created' });
          }),
      });
      const workflows = makeWorkflows({
        repository,
        ensureProductExists: () =>
          Effect.sync(() => {
            productValidated++;
          }),
        ensureLocationExists: () =>
          Effect.sync(() => {
            locationValidated++;
          }),
        getInventoryOrFail: (id) =>
          Effect.succeed(makeInventory({ id, area_id: AREA_ID })),
      });

      const result = yield* workflows.create(createDto);

      expect(productValidated).toBe(1);
      expect(locationValidated).toBe(1);
      expect(capturedCreate).toEqual({
        product_id: PRODUCT_ID,
        location_id: LOCATION_ID,
        area_id: AREA_ID,
        quantity: 10,
        batch_number: 'BATCH-NEW',
        expiry_date: createDto.expiry_date,
        cost_per_unit: 7.5,
        received_date: createDto.received_date,
      });
      expect(result).toMatchObject({
        id: 'inventory-created',
        area_id: AREA_ID,
        quantity: 25,
      });
    }),
  );

  it.effect('updates location and area only after checking uniqueness', () =>
    Effect.gen(function* () {
      let current = makeInventory();
      let capturedUpdate: InventoryUpdateData | undefined;
      let duplicateLookupCount = 0;
      const repository = makeRepository({
        findByProductAndLocationWithRelations: () =>
          Effect.sync(() => {
            duplicateLookupCount++;
            return null;
          }),
        update: (_id, data) =>
          Effect.sync(() => {
            capturedUpdate = data;
            current = makeInventory({ ...current, ...data });
            return current;
          }),
      });
      const workflows = makeWorkflows({
        repository,
        area: makeArea({ id: NEXT_AREA_ID, location_id: NEXT_LOCATION_ID }),
        getInventoryOrFail: () => Effect.succeed(current),
      });
      const dto: UpdateInventoryDto = {
        location_id: NEXT_LOCATION_ID,
        area_id: NEXT_AREA_ID,
      };

      const result = yield* workflows.update('inventory-1', dto);

      expect(duplicateLookupCount).toBe(1);
      expect(capturedUpdate).toEqual({
        location_id: NEXT_LOCATION_ID,
        area_id: NEXT_AREA_ID,
      });
      expect(result).toMatchObject({
        location_id: NEXT_LOCATION_ID,
        area_id: NEXT_AREA_ID,
      });
    }),
  );

  it.effect('returns current inventory without writing an empty update', () =>
    Effect.gen(function* () {
      let updateCalled = false;
      const repository = makeRepository({
        update: () =>
          Effect.sync(() => {
            updateCalled = true;
            return makeInventory();
          }),
      });
      const workflows = makeWorkflows({ repository });

      const result = yield* workflows.update('inventory-1', {});

      expect(updateCalled).toBe(false);
      expect(result).toMatchObject({
        id: 'inventory-1',
        quantity: 25,
      });
    }),
  );

  it.effect('adjusts quantity and reloads the inventory row', () =>
    Effect.gen(function* () {
      let current = makeInventory({ quantity: 10 });
      let capturedAdjustment: number | undefined;
      const repository = makeRepository({
        adjustQuantity: (_id, adjustment) =>
          Effect.sync(() => {
            capturedAdjustment = adjustment;
            current = makeInventory({
              ...current,
              quantity: current.quantity + adjustment,
            });
            return 1;
          }),
      });
      const workflows = makeWorkflows({
        repository,
        getInventoryOrFail: () => Effect.succeed(current),
      });
      const dto: AdjustInventoryDto = { adjustment: -3 };

      const result = yield* workflows.adjustQuantity('inventory-1', dto);

      expect(capturedAdjustment).toBe(-3);
      expect(result.quantity).toBe(7);
    }),
  );

  it.effect('deletes only after the inventory row exists', () =>
    Effect.gen(function* () {
      let deletedId: string | undefined;
      const repository = makeRepository({
        delete: (id) =>
          Effect.sync(() => {
            deletedId = id;
          }),
      });
      const workflows = makeWorkflows({ repository });

      yield* workflows.delete('inventory-1');

      expect(deletedId).toBe('inventory-1');
    }),
  );
});
