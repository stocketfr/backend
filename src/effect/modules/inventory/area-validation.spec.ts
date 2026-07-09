import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import type { AreaResponseDto } from '@stocket/types/areas';
import {
  AreaNotFound,
  AreasInfrastructureError,
} from '../areas/areas.errors';
import {
  getAreaForInventoryLocation,
  type InventoryAreaLookup,
} from './area-validation';

const area = (
  overrides: Partial<AreaResponseDto> = {},
): AreaResponseDto => ({
  id: 'area-1',
  location_id: 'location-1',
  parent_id: null,
  name: 'Cold Storage',
  code: 'COLD',
  description: '',
  is_active: true,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const lookup = (
  effect: Effect.Effect<AreaResponseDto, AreaNotFound | AreasInfrastructureError>,
): InventoryAreaLookup => ({
  findById: () => effect,
});

describe('getAreaForInventoryLocation', () => {
  it.effect('returns the area when it belongs to the requested location', () =>
    Effect.gen(function* () {
      const result = yield* getAreaForInventoryLocation(
        lookup(Effect.succeed(area())),
        'area-1',
        'location-1',
      );

      expect(result).toMatchObject({ id: 'area-1', location_id: 'location-1' });
    }),
  );

  it.effect('maps missing areas to InvalidInventoryArea', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        getAreaForInventoryLocation(
          lookup(
            Effect.fail(
              new AreaNotFound({
                id: 'area-1',
                messageKey: 'areas.notFound',
              }),
            ),
          ),
          'area-1',
          'location-1',
        ),
      );

      expect(error).toMatchObject({
        _tag: 'InvalidInventoryArea',
        areaId: 'area-1',
      });
    }),
  );

  it.effect('maps area infrastructure failures to inventory infrastructure failures', () =>
    Effect.gen(function* () {
      const cause = new AreasInfrastructureError({
        action: 'load area',
        messageKey: 'areas.infrastructureFailed',
      });

      const error = yield* Effect.flip(
        getAreaForInventoryLocation(
          lookup(Effect.fail(cause)),
          'area-1',
          'location-1',
        ),
      );

      expect(error).toMatchObject({
        _tag: 'InventoryInfrastructureError',
        action: 'load inventory area',
        cause,
      });
    }),
  );

  it.effect('fails when the area belongs to a different location', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        getAreaForInventoryLocation(
          lookup(Effect.succeed(area({ location_id: 'other-location' }))),
          'area-1',
          'location-1',
        ),
      );

      expect(error).toMatchObject({
        _tag: 'InventoryAreaLocationMismatch',
        areaId: 'area-1',
        locationId: 'location-1',
      });
    }),
  );
});
