import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import {
  validateAreaReferences,
  type AreaParentReference,
  type AreaReferenceLookup,
} from './reference-validation';

const lookup = ({
  locationExists = true,
  parent = { id: 'parent-1', location_id: 'location-1' },
}: {
  readonly locationExists?: boolean;
  readonly parent?: AreaParentReference | null;
} = {}): AreaReferenceLookup => ({
  locationExists: () => Effect.succeed(locationExists),
  findParentArea: () => Effect.succeed(parent),
});

describe('validateAreaReferences', () => {
  it.effect('succeeds when location and parent references are valid', () =>
    validateAreaReferences({
      lookup: lookup(),
      dto: {
        location_id: 'location-1',
        parent_id: 'parent-1',
      },
    }),
  );

  it.effect('fails when the target location does not exist', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateAreaReferences({
          lookup: lookup({ locationExists: false }),
          dto: { location_id: 'missing-location' },
        }),
      );

      expect(error).toMatchObject({
        _tag: 'AreaLocationNotFound',
        locationId: 'missing-location',
      });
    }),
  );

  it.effect('fails when the parent area does not exist', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateAreaReferences({
          lookup: lookup({ parent: null }),
          dto: {
            location_id: 'location-1',
            parent_id: 'missing-parent',
          },
        }),
      );

      expect(error).toMatchObject({
        _tag: 'ParentAreaNotFound',
        parentId: 'missing-parent',
      });
    }),
  );

  it.effect('fails when the parent area belongs to a different location', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validateAreaReferences({
          lookup: lookup({
            parent: { id: 'parent-1', location_id: 'other-location' },
          }),
          dto: {
            location_id: 'location-1',
            parent_id: 'parent-1',
          },
        }),
      );

      expect(error).toMatchObject({
        _tag: 'AreaParentLocationMismatch',
        parentId: 'parent-1',
        locationId: 'location-1',
      });
    }),
  );

  it.effect(
    'uses the current location when validating update parent changes',
    () =>
      Effect.gen(function* () {
        yield* validateAreaReferences({
          lookup: lookup(),
          dto: { parent_id: 'parent-1' },
          currentLocationId: 'location-1',
        });

        const error = yield* Effect.flip(
          validateAreaReferences({
            lookup: lookup({
              parent: { id: 'parent-1', location_id: 'other-location' },
            }),
            dto: { parent_id: 'parent-1' },
            currentLocationId: 'location-1',
          }),
        );

        expect(error).toMatchObject({
          _tag: 'AreaParentLocationMismatch',
          parentId: 'parent-1',
          locationId: 'location-1',
        });
      }),
  );
});
