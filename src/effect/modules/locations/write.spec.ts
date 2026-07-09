import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { LocationType } from '@stocket/types/locations';
import {
  makeLocationWriteWorkflows,
  type LocationWriteRepository,
} from './write';
import type { LocationEntity } from './types';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-03-01T00:00:00.000Z');

const makeLocation = (
  overrides: Partial<LocationEntity> = {},
): LocationEntity => ({
  id: 'location-1',
  tenant_id: tenantId,
  name: 'Warehouse A',
  type: LocationType.WAREHOUSE,
  address: '',
  contact_person: '',
  phone: '',
  is_active: true,
  created_at: now,
  updated_at: now,
  ...overrides,
});

type LocationCreateData = Parameters<LocationWriteRepository['create']>[0];
type LocationUpdateData = Parameters<LocationWriteRepository['update']>[1];

const makeRepository = (
  overrides: Partial<LocationWriteRepository> = {},
): LocationWriteRepository => ({
  create: (values) =>
    Effect.succeed(
      makeLocation({
        ...values,
      }),
    ),
  update: (_id, values) =>
    Effect.succeed(
      makeLocation({
        ...values,
      }),
    ),
  ...overrides,
});

describe('makeLocationWriteWorkflows', () => {
  it.effect('creates a location from normalized create values', () =>
    Effect.gen(function* () {
      let capturedCreate: LocationCreateData | undefined;
      const repository = makeRepository({
        create: (values) =>
          Effect.sync(() => {
            capturedCreate = values;
            return makeLocation({ id: 'location-new', ...values });
          }),
      });
      const workflows = makeLocationWriteWorkflows({
        repository,
        getLocationOrFail: () => Effect.succeed(makeLocation()),
      });

      const result = yield* workflows.create({
        name: 'Client Dock',
        type: LocationType.CLIENT,
      });

      expect(capturedCreate).toEqual({
        name: 'Client Dock',
        type: LocationType.CLIENT,
        address: '',
        contact_person: '',
        phone: '',
        is_active: true,
      });
      expect(result).toMatchObject({
        id: 'location-new',
        name: 'Client Dock',
        type: LocationType.CLIENT,
      });
    }),
  );

  it.effect(
    'returns the current location without writing an empty update',
    () =>
      Effect.gen(function* () {
        let updateCalled = false;
        const existing = makeLocation({ name: 'Existing Warehouse' });
        const repository = makeRepository({
          update: () =>
            Effect.sync(() => {
              updateCalled = true;
              return makeLocation();
            }),
        });
        const workflows = makeLocationWriteWorkflows({
          repository,
          getLocationOrFail: () => Effect.succeed(existing),
        });

        const result = yield* workflows.update('location-1', {});

        expect(result.name).toBe('Existing Warehouse');
        expect(updateCalled).toBe(false);
      }),
  );

  it.effect('updates changed location fields', () =>
    Effect.gen(function* () {
      let capturedUpdate:
        | {
            readonly id: string;
            readonly values: LocationUpdateData;
          }
        | undefined;
      const repository = makeRepository({
        update: (id, values) =>
          Effect.sync(() => {
            capturedUpdate = { id, values };
            return makeLocation({
              id,
              name: values.name ?? 'Warehouse A',
              is_active: values.is_active ?? true,
            });
          }),
      });
      const workflows = makeLocationWriteWorkflows({
        repository,
        getLocationOrFail: () => Effect.succeed(makeLocation()),
      });

      const result = yield* workflows.update('location-1', {
        name: 'Updated Warehouse',
        is_active: false,
      });

      expect(capturedUpdate).toEqual({
        id: 'location-1',
        values: {
          name: 'Updated Warehouse',
          is_active: false,
        },
      });
      expect(result).toMatchObject({
        id: 'location-1',
        name: 'Updated Warehouse',
        is_active: false,
      });
    }),
  );

  it.effect('fails with LocationNotFound when an update races a delete', () =>
    Effect.gen(function* () {
      const workflows = makeLocationWriteWorkflows({
        repository: makeRepository({
          update: () => Effect.succeed(null),
        }),
        getLocationOrFail: () => Effect.succeed(makeLocation()),
      });

      const error = yield* Effect.flip(
        workflows.update('missing-location', { name: 'Updated Warehouse' }),
      );

      expect(error).toMatchObject({
        _tag: 'LocationNotFound',
        id: 'missing-location',
      });
    }),
  );
});
