import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  makeAreaWriteWorkflows,
  type AreaWriteRepository,
} from './write';

const NOW = new Date('2026-01-01T00:00:00.000Z');

type AreaCreateData = Parameters<AreaWriteRepository['create']>[0];
type AreaUpdateData = Parameters<AreaWriteRepository['update']>[1];
type AreaEntity = NonNullable<
  Effect.Effect.Success<ReturnType<AreaWriteRepository['findById']>>
>;

const makeArea = (overrides: Partial<AreaEntity> = {}): AreaEntity => ({
  id: 'area-1',
  tenant_id: 'tenant-1',
  location_id: 'loc-1',
  parent_id: null,
  name: 'Zone A',
  code: 'ZA',
  description: 'Main zone',
  is_active: true,
  created_at: NOW,
  updated_at: NOW,
  location: null,
  ...overrides,
});

const makeRepository = (
  overrides: Partial<AreaWriteRepository> = {},
): AreaWriteRepository => ({
  create: () => Effect.succeed(makeArea()),
  delete: () => Effect.succeed(true),
  findById: () => Effect.succeed(makeArea()),
  update: () => Effect.succeed(makeArea()),
  ...overrides,
});

const makeWorkflows = ({
  repository,
  locationExists = () => Effect.succeed(true),
}: {
  readonly repository: AreaWriteRepository;
  readonly locationExists?: (locationId: string) => Effect.Effect<boolean>;
}) =>
  makeAreaWriteWorkflows({
    repository,
    locationExists,
  });

describe('makeAreaWriteWorkflows', () => {
  it.effect('creates an area after validating the location and parent area', () =>
    Effect.gen(function* () {
      let checkedLocation: string | undefined;
      let capturedCreate: AreaCreateData | undefined;
      const repository = makeRepository({
        findById: (id) =>
          Effect.succeed(
            id === 'parent-1'
              ? makeArea({ id: 'parent-1', location_id: 'loc-1' })
              : null,
          ),
        create: (data) =>
          Effect.sync(() => {
            capturedCreate = data;
            return makeArea({
              id: 'area-new',
              location_id: data.location_id,
              parent_id: data.parent_id ?? null,
              name: data.name,
            });
          }),
      });
      const workflows = makeWorkflows({
        repository,
        locationExists: (locationId) =>
          Effect.sync(() => {
            checkedLocation = locationId;
            return true;
          }),
      });

      const result = yield* workflows.create({
        location_id: 'loc-1',
        parent_id: 'parent-1',
        name: 'Zone B',
      });

      expect(checkedLocation).toBe('loc-1');
      expect(capturedCreate).toEqual({
        location_id: 'loc-1',
        parent_id: 'parent-1',
        name: 'Zone B',
      });
      expect(result).toMatchObject({
        id: 'area-new',
        parent_id: 'parent-1',
      });
    }),
  );

  it.effect('rejects parent areas from a different location', () =>
    Effect.gen(function* () {
      const repository = makeRepository({
        findById: () => Effect.succeed(makeArea({ location_id: 'loc-other' })),
      });
      const workflows = makeWorkflows({ repository });

      const error = yield* Effect.flip(
        workflows.create({
          location_id: 'loc-1',
          parent_id: 'parent-1',
          name: 'Zone B',
        }),
      );

      expect(error).toMatchObject({
        _tag: 'AreaParentLocationMismatch',
        parentId: 'parent-1',
        locationId: 'loc-1',
      });
    }),
  );

  it.effect('updates an area after validating a parent move', () =>
    Effect.gen(function* () {
      let capturedUpdate: AreaUpdateData | undefined;
      const repository = makeRepository({
        findById: (id) =>
          Effect.succeed(
            id === 'area-1'
              ? makeArea({ id: 'area-1', location_id: 'loc-1' })
              : makeArea({ id, location_id: 'loc-1', parent_id: null }),
          ),
        update: (_id, data) =>
          Effect.sync(() => {
            capturedUpdate = data;
            return makeArea({ ...data });
          }),
      });
      const workflows = makeWorkflows({ repository });

      const result = yield* workflows.update('area-1', {
        parent_id: 'parent-1',
        name: 'Updated Area',
      });

      expect(capturedUpdate).toEqual({
        parent_id: 'parent-1',
        name: 'Updated Area',
      });
      expect(result).toMatchObject({
        parent_id: 'parent-1',
        name: 'Updated Area',
      });
    }),
  );

  it.effect('detects circular parent references', () =>
    Effect.gen(function* () {
      const repository = makeRepository({
        findById: (id) => {
          if (id === 'area-1') return Effect.succeed(makeArea({ id }));
          if (id === 'area-2') {
            return Effect.succeed(
              makeArea({ id, location_id: 'loc-1', parent_id: 'area-1' }),
            );
          }
          return Effect.succeed(null);
        },
      });
      const workflows = makeWorkflows({ repository });

      const error = yield* Effect.flip(
        workflows.update('area-1', { parent_id: 'area-2' }),
      );

      expect(error).toMatchObject({
        _tag: 'AreaCircularReference',
        id: 'area-1',
        parentId: 'area-2',
      });
    }),
  );

  it.effect('deletes an area through the repository', () =>
    Effect.gen(function* () {
      let deletedId: string | undefined;
      const repository = makeRepository({
        delete: (id) =>
          Effect.sync(() => {
            deletedId = id;
            return true;
          }),
      });
      const workflows = makeWorkflows({ repository });

      yield* workflows.delete('area-1');

      expect(deletedId).toBe('area-1');
    }),
  );
});
