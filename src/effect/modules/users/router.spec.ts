/**
 * Unit-scope tests for `usersRouter`.
 *
 * Per-route: permission guard, decode, service-success, service-error.
 *
 * Special focus: `PUT /users/:id/roles` is the RBAC hotspot (per
 * `MEMORY.md` — frontend `UpdateRolesDialog` submits role UUIDs here;
 * the service then writes `user_roles`, syncs `admin`/`user` to Better
 * Auth, and invalidates the permission cache). We cover:
 *   - permission guard (caller lacks `users:write`)
 *   - decode (non-UUID role id, missing field)
 *   - success with multiple valid role ids
 *   - success with empty array (clears all roles)
 *   - service failure on unknown role id → propagated status
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import type { UserResponseDto } from '@stocket/types/users';
import { BetterAuthHeaders } from '../../platform/auth/better-auth';
import { UserNotFound, UsersInfrastructureError } from './users.errors';
import { makeUsersRouterHarness } from './__fixtures__/router-harness';
import { UsersService } from './service';

const VALID_USER_ID = '00000000-0000-4000-a000-000000000001';
const mockRequireSession = vi.fn();
const mockGetOptionalSession = vi.fn();

vi.mock('../../platform/http/session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');
  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
    getOptionalSession: Effect.suspend(() => mockGetOptionalSession()),
    // `getRequestHeaders` still lives in the real module — preserve it by
    // re-exporting the actual implementation so the users router keeps
    // working. We only override the session helpers.
    getRequestHeaders: (
      await vi.importActual<typeof import('../../platform/http/session')>(
        '../../platform/http/session',
      )
    ).getRequestHeaders,
  };
});

vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    UsersService: Context.GenericTag('@stocket/test/UsersService'),
    usersLayer: Layer.empty,
  };
});

const TARGET_USER_ID = '77777777-7777-4777-8777-777777777777';
const ROLE_ID_1 = '88888888-8888-4888-8888-888888888888';
const ROLE_ID_2 = '99999999-9999-4999-8999-999999999999';

const makeUser = (
  overrides: Partial<UserResponseDto> = {},
): UserResponseDto => ({
  id: TARGET_USER_ID,
  name: 'Target User',
  email: 'target@example.com',
  image: null,
  roles: ['Admin'],
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const writeAll: Partial<Record<Resource, Permission[]>> = {
  [Resource.USERS]: [Permission.READ, Permission.WRITE],
};
const readOnly: Partial<Record<Resource, Permission[]>> = {
  [Resource.USERS]: [Permission.READ],
};
const noAccess: Partial<Record<Resource, Permission[]>> = {};
const jsonHeaders = { 'content-type': 'application/json' };

describe('usersRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const session = { user: { id: VALID_USER_ID } };
    mockRequireSession.mockReturnValue(Effect.succeed(session));
    mockGetOptionalSession.mockReturnValue(Effect.succeed(session));
  });

  // -------------------------------------------------------------------
  // GET /users (paginated list)
  // -------------------------------------------------------------------
  describe('GET /users', () => {
    it('rejects without users:read', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          listUsers: () => Effect.die('should not run'),
        },
        permissions: noAccess,
      });
      const response = await handler(new Request('http://localhost/users'));
      expect(response.status).toBe(403);
    });

    it('returns 400 when the query fails to decode', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          listUsers: () => Effect.die('should not run'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/users?page=not-a-number'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the paginated payload on success', async () => {
      const paginated = {
        data: [makeUser()],
        total: 1,
        page: 1,
        limit: 20,
        total_pages: 1,
      };
      const listUsers = vi.fn(() => Effect.succeed(paginated));
      const { handler } = makeUsersRouterHarness({
        service: { listUsers },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/users?page=1&limit=20'),
      );
      expect(response.status).toBe(200);
      // Router wraps the service result via `toPaginatedResponse`, which
      // nests pagination under `meta` and keeps `data` at the top.
      await expect(response.json()).resolves.toMatchObject({
        data: [{ id: TARGET_USER_ID }],
        meta: { total: 1, page: 1, limit: 20 },
      });
      expect(listUsers).toHaveBeenCalledTimes(1);
    });

    it('maps infrastructure failure to 500', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          listUsers: () =>
            Effect.fail(
              new UsersInfrastructureError({
                action: 'list users',
                messageKey: 'users.infrastructureFailed',
              }),
            ),
        },
        permissions: readOnly,
      });
      const response = await handler(new Request('http://localhost/users'));
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /users/:id
  // -------------------------------------------------------------------
  describe('GET /users/:id', () => {
    it('rejects without users:read', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { getUser: () => Effect.succeed(makeUser()) },
        permissions: noAccess,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the id is not a UUID', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          getUser: () => Effect.die('should not run'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/users/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the user on success', async () => {
      const getUser = vi.fn(() => Effect.succeed(makeUser()));
      const { handler } = makeUsersRouterHarness({
        service: { getUser },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}`),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: TARGET_USER_ID,
      });
      expect(getUser).toHaveBeenCalledWith(TARGET_USER_ID);
    });

    it('maps UserNotFound → 404', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          getUser: (id: string) =>
            Effect.fail(new UserNotFound({ id, messageKey: 'users.notFound' })),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /users
  // -------------------------------------------------------------------
  describe('POST /users', () => {
    const validBody = {
      name: 'New User',
      email: 'new-user@example.com',
      password: 'password123',
      roles: [ROLE_ID_1],
    };

    it('rejects without users:write', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          createUser: () => Effect.die('should not run'),
        },
        permissions: readOnly,
      });
      const response = await handler(
        new Request('http://localhost/users', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body contains a non-UUID role id', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          createUser: () => Effect.die('should not run'),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/users', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ ...validBody, roles: ['not-a-uuid'] }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('passes the create payload and request headers to the service', async () => {
      let capturedAuthorization: string | null = null;
      const createUser = vi.fn((dto: typeof validBody) =>
        Effect.gen(function* () {
          const headers = yield* BetterAuthHeaders;
          capturedAuthorization = headers.get('authorization');
          return makeUser({
            name: dto.name,
            email: dto.email,
            roles: ['Warehouse Manager'],
          });
        }),
      );
      const { handler } = makeUsersRouterHarness({
        service: { createUser },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/users', {
          method: 'POST',
          headers: {
            ...jsonHeaders,
            authorization: 'Bearer admin-token',
          },
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        name: 'New User',
        email: 'new-user@example.com',
        roles: ['Warehouse Manager'],
      });
      expect(createUser).toHaveBeenCalledWith(validBody);
      expect(capturedAuthorization).toBe('Bearer admin-token');
    });
  });

  // -------------------------------------------------------------------
  // PUT /users/:id/roles — RBAC hotspot
  // -------------------------------------------------------------------
  describe('PUT /users/:id/roles [RBAC hotspot]', () => {
    const validBody = { roles: [ROLE_ID_1, ROLE_ID_2] };

    it('rejects without users:write (wrong permission)', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          updateRoles: () => Effect.die('should not run'),
        },
        // Reader can't rewrite role assignments.
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/roles`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body contains a non-UUID role id', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          updateRoles: () => Effect.die('should not run'),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/roles`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify({ roles: ['not-a-uuid'] }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 400 when the `roles` field is missing', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          updateRoles: () => Effect.die('should not run'),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/roles`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify({}),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and forwards the exact role id list on success', async () => {
      const updated = makeUser({ roles: ['Admin', 'Warehouse Manager'] });
      const updateRoles = vi.fn(() => Effect.succeed(updated));
      const { handler } = makeUsersRouterHarness({
        service: { updateRoles },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/roles`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        id: TARGET_USER_ID,
        roles: ['Admin', 'Warehouse Manager'],
      });
      expect(updateRoles).toHaveBeenCalledWith(TARGET_USER_ID, [
        ROLE_ID_1,
        ROLE_ID_2,
      ]);
    });

    it('accepts an empty array (clears all role assignments)', async () => {
      const cleared = makeUser({ roles: [] });
      const updateRoles = vi.fn(() => Effect.succeed(cleared));
      const { handler } = makeUsersRouterHarness({
        service: { updateRoles },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/roles`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify({ roles: [] }),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ roles: [] });
      expect(updateRoles).toHaveBeenCalledWith(TARGET_USER_ID, []);
    });

    it('maps UserNotFound from the service → 404', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          updateRoles: (id: string) =>
            Effect.fail(new UserNotFound({ id, messageKey: 'users.notFound' })),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/roles`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(404);
    });

    it('maps infrastructure failure from the service → 500', async () => {
      // Simulates the "unknown role id" path — the service raises
      // `UsersInfrastructureError` when `replaceUserRoles` hits a FK
      // violation on an id that doesn't exist in the `roles` table.
      const { handler } = makeUsersRouterHarness({
        service: {
          updateRoles: () =>
            Effect.fail(
              new UsersInfrastructureError({
                action: 'replaceUserRoles',
                messageKey: 'users.infrastructureFailed',
              }),
            ),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/roles`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // PATCH /users/:id/ban
  // -------------------------------------------------------------------
  describe('PATCH /users/:id/ban', () => {
    const validBody = { reason: 'Violation' };

    it('rejects without users:write', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { banUser: () => Effect.succeed(makeUser({ banned: true })) },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/ban`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when `reason` is the wrong type', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { banUser: () => Effect.die('should not run') },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/ban`, {
          method: 'PATCH',
          headers: jsonHeaders,
          // `reason` is optional String — a number fails decode
          body: JSON.stringify({ reason: 42 }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 with the banned user on success', async () => {
      const banned = makeUser({ banned: true, banReason: 'Violation' });
      const banUser = vi.fn(() => Effect.succeed(banned));
      const { handler } = makeUsersRouterHarness({
        service: { banUser },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/ban`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ banned: true });
    });

    it('maps UserNotFound → 404', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          banUser: (id: string) =>
            Effect.fail(new UserNotFound({ id, messageKey: 'users.notFound' })),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/ban`, {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // PATCH /users/:id/unban
  // -------------------------------------------------------------------
  describe('PATCH /users/:id/unban', () => {
    it('rejects without users:write', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { unbanUser: () => Effect.succeed(makeUser()) },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/unban`, {
          method: 'PATCH',
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the id is not a UUID', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { unbanUser: () => Effect.die('should not run') },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/users/bad-id/unban', {
          method: 'PATCH',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns the unbanned user on success', async () => {
      const unbanUser = vi.fn(() =>
        Effect.succeed(makeUser({ banned: false })),
      );
      const { handler } = makeUsersRouterHarness({
        service: { unbanUser },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/unban`, {
          method: 'PATCH',
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ banned: false });
      expect(unbanUser).toHaveBeenCalledWith(TARGET_USER_ID);
    });

    it('maps UserNotFound → 404', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          unbanUser: (id: string) =>
            Effect.fail(new UserNotFound({ id, messageKey: 'users.notFound' })),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}/unban`, {
          method: 'PATCH',
        }),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // DELETE /users/:id
  // -------------------------------------------------------------------
  describe('DELETE /users/:id', () => {
    it('rejects without users:write', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { deleteUser: () => Effect.void },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the id is not a UUID', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { deleteUser: () => Effect.die('should not run') },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/users/bad-id', { method: 'DELETE' }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 on success', async () => {
      const deleteUser = vi.fn(() => Effect.void);
      const { handler } = makeUsersRouterHarness({
        service: { deleteUser },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(200);
      expect(deleteUser).toHaveBeenCalledWith(TARGET_USER_ID);
    });

    it('maps UserNotFound → 404', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          deleteUser: (id: string) =>
            Effect.fail(new UserNotFound({ id, messageKey: 'users.notFound' })),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(`http://localhost/users/${TARGET_USER_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /users/:id/revoke-sessions
  // -------------------------------------------------------------------
  describe('POST /users/:id/revoke-sessions', () => {
    it('rejects without users:write', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { revokeSessions: () => Effect.void },
        permissions: readOnly,
      });
      const response = await handler(
        new Request(
          `http://localhost/users/${TARGET_USER_ID}/revoke-sessions`,
          { method: 'POST' },
        ),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the id is not a UUID', async () => {
      const { handler } = makeUsersRouterHarness({
        service: { revokeSessions: () => Effect.die('should not run') },
        permissions: writeAll,
      });
      const response = await handler(
        new Request('http://localhost/users/bad-id/revoke-sessions', {
          method: 'POST',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 on success', async () => {
      const revokeSessions = vi.fn(() => Effect.void);
      const { handler } = makeUsersRouterHarness({
        service: { revokeSessions },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(
          `http://localhost/users/${TARGET_USER_ID}/revoke-sessions`,
          { method: 'POST' },
        ),
      );
      expect(response.status).toBe(200);
      expect(revokeSessions).toHaveBeenCalledWith(TARGET_USER_ID);
    });

    it('maps UserNotFound → 404', async () => {
      const { handler } = makeUsersRouterHarness({
        service: {
          revokeSessions: (id: string) =>
            Effect.fail(new UserNotFound({ id, messageKey: 'users.notFound' })),
        },
        permissions: writeAll,
      });
      const response = await handler(
        new Request(
          `http://localhost/users/${TARGET_USER_ID}/revoke-sessions`,
          { method: 'POST' },
        ),
      );
      expect(response.status).toBe(404);
    });
  });

  it('has UsersService tag available', () => {
    expect(UsersService).toBeDefined();
  });
});
