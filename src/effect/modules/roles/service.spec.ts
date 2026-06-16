import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { DrizzleDatabase, type DrizzleDb } from '../../platform/db/drizzle';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { createChainableMock } from '../../testing/utils';
import { RolesService } from './service';
import { RolesRepository } from './repository';
import { SystemRoleDeletionForbidden } from './roles.errors';

const tenantRequestContext = {
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/roles',
  method: 'GET' as const,
  ip: null,
  locale: 'en' as const,
  tenantId: '00000000-0000-4000-8000-000000000001',
};

describe('Effect RolesService', () => {
  const makeService = async (
    repository: Record<string, Mock>,
    mockDb: unknown,
  ) =>
    Effect.runPromise(
      RolesService.pipe(
        Effect.provide(
          RolesService.DefaultWithoutDependencies.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  RolesRepository,
                  repository as unknown as typeof RolesRepository.Service,
                ),
                Layer.succeed(DrizzleDatabase, mockDb as DrizzleDb),
              ),
            ),
          ),
        ),
      ),
    );

  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(CurrentRequestContext, tenantRequestContext),
      ),
    );
  const fail = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(
      Effect.flip(effect).pipe(
        Effect.provideService(CurrentRequestContext, tenantRequestContext),
      ),
    );

  const roleEntity = {
    id: 'role-1',
    name: 'Admin',
    description: 'Full system access',
    is_system: true,
    permissions: [
      {
        role_id: 'role-1',
        resource: Resource.ROLES,
        permission: Permission.READ,
      },
    ],
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  };

  it('creates a role', async () => {
    const repository = {
      findAll: vi.fn(),
      findById: vi.fn().mockReturnValue(
        Effect.succeed({
          ...roleEntity,
          id: 'role-2',
          name: 'Manager',
          description: 'Warehouse manager',
          is_system: false,
        }),
      ),
      findByName: vi.fn().mockReturnValue(Effect.succeed(null)),
      create: vi.fn().mockReturnValue(
        Effect.succeed({
          ...roleEntity,
          id: 'role-2',
          name: 'Manager',
          description: 'Warehouse manager',
          is_system: false,
        }),
      ),
      update: vi.fn(),
      delete: vi.fn(),
      replacePermissions: vi.fn().mockReturnValue(Effect.void),
    };
    const mockDb = createChainableMock([]);
    const service = await makeService(repository, mockDb);

    const result = await run(
      service.create({
        name: 'Manager',
        description: 'Warehouse manager',
        permissions: [
          { resource: Resource.ROLES, permission: Permission.READ },
        ],
      }),
    );

    expect(repository.create).toHaveBeenCalledWith({
      tenant_id: '00000000-0000-4000-8000-000000000001',
      name: 'Manager',
      description: 'Warehouse manager',
      is_system: false,
    });
    expect(result.name).toBe('Manager');
  });

  it('rejects duplicate role names', async () => {
    const repository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findByName: vi.fn().mockReturnValue(Effect.succeed(roleEntity)),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      replacePermissions: vi.fn(),
    };
    const service = await makeService(repository, createChainableMock([]));

    await expect(
      fail(
        service.create({
          name: 'Admin',
          permissions: [],
        }),
      ),
    ).resolves.toMatchObject({
      _tag: 'RoleNameAlreadyExists',
      statusCode: 409,
    });
  });

  it('updates a role', async () => {
    const repository = {
      findAll: vi.fn(),
      findById: vi
        .fn()
        .mockReturnValueOnce(
          Effect.succeed({
            ...roleEntity,
            id: 'role-2',
            name: 'Manager',
            description: 'Old',
            is_system: false,
          }),
        )
        .mockReturnValueOnce(
          Effect.succeed({
            ...roleEntity,
            id: 'role-2',
            name: 'Manager Updated',
            description: 'New',
            is_system: false,
          }),
        ),
      findByName: vi.fn().mockReturnValue(Effect.succeed(null)),
      create: vi.fn(),
      update: vi.fn().mockReturnValue(Effect.void),
      delete: vi.fn(),
      replacePermissions: vi.fn().mockReturnValue(Effect.void),
    };
    const service = await makeService(repository, createChainableMock([]));

    const result = await run(
      service.update('role-2', {
        name: 'Manager Updated',
        description: 'New',
        permissions: [
          { resource: Resource.ROLES, permission: Permission.WRITE },
        ],
      }),
    );

    expect(repository.update).toHaveBeenCalledWith(
      'role-2',
      '00000000-0000-4000-8000-000000000001',
      {
        name: 'Manager Updated',
        description: 'New',
      },
    );
    expect(repository.replacePermissions).toHaveBeenCalled();
    expect(result.name).toBe('Manager Updated');
  });

  it('prevents deleting a system role', async () => {
    const repository = {
      findAll: vi.fn(),
      findById: vi.fn().mockReturnValue(Effect.succeed(roleEntity)),
      findByName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      replacePermissions: vi.fn(),
    };
    const service = await makeService(repository, createChainableMock([]));

    await expect(fail(service.delete('role-1'))).resolves.toBeInstanceOf(
      SystemRoleDeletionForbidden,
    );
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it('caches permissions and refreshes after ttl expiry', async () => {
    const repository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      findByName: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      replacePermissions: vi.fn(),
    };
    const mockDb = createChainableMock([
      {
        role_name: 'Admin',
        resource: Resource.ROLES,
        permission: Permission.READ,
      },
    ]);
    const service = await makeService(repository, mockDb);
    let now = 1_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

    await run(service.getPermissionsForUser('user-1'));
    await run(service.getPermissionsForUser('user-1'));
    await run(
      service.getPermissionsForUser(
        'user-1',
        '00000000-0000-4000-8000-000000000002',
      ),
    );
    now += 61_000;
    await run(service.getPermissionsForUser('user-1'));

    expect(mockDb.select).toHaveBeenCalledTimes(3);
    nowSpy.mockRestore();
  });
});
