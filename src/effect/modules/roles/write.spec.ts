import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import type { RolePermissionDto } from '@stocket/types/roles';
import { defaultRoleSeedDefinitions } from '../../platform/seed/default-roles';
import type { RoleWithPermissions } from './types';
import { makeRoleWriteWorkflows, type RoleWriteRepository } from './write';

const tenantId = '00000000-0000-4000-8000-000000000001';
const now = new Date('2026-03-01T00:00:00.000Z');

const makeRole = (
  overrides: Partial<RoleWithPermissions> = {},
): RoleWithPermissions => ({
  id: 'role-1',
  tenant_id: tenantId,
  name: 'Admin',
  description: 'Full access',
  is_system: false,
  created_at: now,
  updated_at: now,
  permissions: [
    {
      id: 'permission-1',
      role_id: 'role-1',
      resource: Resource.ROLES,
      permission: Permission.READ,
    },
  ],
  ...overrides,
});

type RoleCreateData = Parameters<RoleWriteRepository['create']>[0];
type RoleUpdateData = Parameters<RoleWriteRepository['update']>[2];

const makeRepository = (
  overrides: Partial<RoleWriteRepository> = {},
): RoleWriteRepository => ({
  findById: () => Effect.succeed(makeRole()),
  findByName: () => Effect.succeed(null),
  create: (data) =>
    Effect.succeed(
      makeRole({
        ...data,
        id: 'role-created',
        permissions: [],
      }),
    ),
  update: () => Effect.void,
  delete: () => Effect.void,
  replacePermissions: () => Effect.void,
  ...overrides,
});

describe('makeRoleWriteWorkflows', () => {
  it.effect('creates a custom role, replaces permissions, and reloads it', () =>
    Effect.gen(function* () {
      let capturedCreate: RoleCreateData | undefined;
      let replaced:
        | {
            readonly tenantId: string;
            readonly roleId: string;
            readonly permissions: RolePermissionDto[];
          }
        | undefined;
      const repository = makeRepository({
        create: (data) =>
          Effect.sync(() => {
            capturedCreate = data;
            return makeRole({ id: 'role-created', ...data, permissions: [] });
          }),
        replacePermissions: (checkedTenantId, roleId, permissions) =>
          Effect.sync(() => {
            replaced = {
              tenantId: checkedTenantId,
              roleId,
              permissions,
            };
          }),
        findById: (id) =>
          Effect.succeed(
            makeRole({
              id,
              name: 'Manager',
              description: 'Warehouse manager',
            }),
          ),
      });
      const workflows = makeRoleWriteWorkflows({
        repository,
        clearAllCache: () => Effect.void,
      });

      const result = yield* workflows.create(
        {
          name: 'Manager',
          description: 'Warehouse manager',
          permissions: [
            { resource: Resource.ROLES, permission: Permission.WRITE },
          ],
        },
        tenantId,
      );

      expect(capturedCreate).toEqual({
        tenant_id: tenantId,
        name: 'Manager',
        description: 'Warehouse manager',
        is_system: false,
      });
      expect(replaced).toEqual({
        tenantId,
        roleId: 'role-created',
        permissions: [
          { resource: Resource.ROLES, permission: Permission.WRITE },
        ],
      });
      expect(result).toMatchObject({
        id: 'role-created',
        name: 'Manager',
      });
    }),
  );

  it.effect('rejects duplicate role names before creating', () =>
    Effect.gen(function* () {
      let createCalled = false;
      const workflows = makeRoleWriteWorkflows({
        repository: makeRepository({
          findByName: () => Effect.succeed(makeRole()),
          create: () =>
            Effect.sync(() => {
              createCalled = true;
              return makeRole();
            }),
        }),
        clearAllCache: () => Effect.void,
      });

      const error = yield* Effect.flip(
        workflows.create({ name: 'Admin', permissions: [] }, tenantId),
      );

      expect(error).toMatchObject({
        _tag: 'RoleNameAlreadyExists',
        name: 'Admin',
      });
      expect(createCalled).toBe(false);
    }),
  );

  it.effect(
    'updates fields, replaces permissions, clears cache, and reloads',
    () =>
      Effect.gen(function* () {
        let capturedUpdate:
          | {
              readonly id: string;
              readonly tenantId: string;
              readonly data: RoleUpdateData;
            }
          | undefined;
        let clearCacheCalls = 0;
        const repository = makeRepository({
          findById: (id) =>
            Effect.succeed(
              makeRole({
                id,
                name: capturedUpdate ? 'Manager Updated' : 'Manager',
                description: capturedUpdate
                  ? 'New description'
                  : 'Old description',
              }),
            ),
          update: (id, checkedTenantId, data) =>
            Effect.sync(() => {
              capturedUpdate = { id, tenantId: checkedTenantId, data };
            }),
        });
        const workflows = makeRoleWriteWorkflows({
          repository,
          clearAllCache: () =>
            Effect.sync(() => {
              clearCacheCalls += 1;
            }),
        });

        const result = yield* workflows.update(
          'role-1',
          {
            name: 'Manager Updated',
            description: 'New description',
            permissions: [
              { resource: Resource.ROLES, permission: Permission.WRITE },
            ],
          },
          tenantId,
        );

        expect(capturedUpdate).toEqual({
          id: 'role-1',
          tenantId,
          data: {
            name: 'Manager Updated',
            description: 'New description',
          },
        });
        expect(clearCacheCalls).toBe(1);
        expect(result.name).toBe('Manager Updated');
      }),
  );

  it.effect('rejects duplicate renamed roles before updating', () =>
    Effect.gen(function* () {
      let updateCalled = false;
      const workflows = makeRoleWriteWorkflows({
        repository: makeRepository({
          findById: () => Effect.succeed(makeRole({ name: 'Manager' })),
          findByName: () => Effect.succeed(makeRole({ id: 'role-other' })),
          update: () =>
            Effect.sync(() => {
              updateCalled = true;
            }),
        }),
        clearAllCache: () => Effect.void,
      });

      const error = yield* Effect.flip(
        workflows.update('role-1', { name: 'Admin' }, tenantId),
      );

      expect(error).toMatchObject({
        _tag: 'RoleNameAlreadyExists',
        name: 'Admin',
      });
      expect(updateCalled).toBe(false);
    }),
  );

  it.effect(
    'prevents deleting system roles and clears cache after custom role deletion',
    () =>
      Effect.gen(function* () {
        let deletedRoleId: string | undefined;
        let clearCacheCalls = 0;
        const workflows = makeRoleWriteWorkflows({
          repository: makeRepository({
            findById: (id) =>
              Effect.succeed(makeRole({ id, is_system: id === 'system-role' })),
            delete: (id) =>
              Effect.sync(() => {
                deletedRoleId = id;
              }),
          }),
          clearAllCache: () =>
            Effect.sync(() => {
              clearCacheCalls += 1;
            }),
        });

        const error = yield* Effect.flip(
          workflows.delete('system-role', tenantId),
        );
        yield* workflows.delete('custom-role', tenantId);

        expect(error).toMatchObject({
          _tag: 'SystemRoleDeletionForbidden',
          id: 'system-role',
        });
        expect(deletedRoleId).toBe('custom-role');
        expect(clearCacheCalls).toBe(1);
      }),
  );

  it.effect('seeds only missing default roles', () =>
    Effect.gen(function* () {
      const createdNames: string[] = [];
      const existingSeedName = defaultRoleSeedDefinitions[0]!.name;
      const workflows = makeRoleWriteWorkflows({
        repository: makeRepository({
          findByName: (name) =>
            Effect.succeed(
              name === existingSeedName ? makeRole({ name }) : null,
            ),
          create: (data) =>
            Effect.sync(() => {
              createdNames.push(data.name);
              return makeRole({ id: `role-${data.name}`, ...data });
            }),
        }),
        clearAllCache: () => Effect.void,
      });

      yield* workflows.seedDefaultRolesForTenant(tenantId);

      expect(createdNames).toEqual(
        defaultRoleSeedDefinitions
          .filter((seed) => seed.name !== existingSeedName)
          .map((seed) => seed.name),
      );
    }),
  );
});
