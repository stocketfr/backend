/**
 * Unit-scope tests for `rolesRouter`.
 *
 * Scope: HTTP boundary only — guard → decode → respond. Service logic
 * lives in `service.spec.ts` / `service.integration.spec.ts`.
 *
 * Canonical coverage per route:
 *   1. Permission guard rejects insufficient role
 *   2. Decode failure on malformed body / params → 400
 *   3. Service success → correct status + payload shape
 *   4. Service tagged error → mapped HTTP status (404 / 409 / 400)
 *
 * Role CRUD is `@Auditable` (see `backend/CLAUDE.md`). The audit writer
 * is fire-and-forget, so we verify it's *called* via a spy — we do not
 * couple to whether its downstream effect succeeds.
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import type { RoleResponseDto } from '@stocket/types/roles';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  RoleNameAlreadyExists,
  RoleNotFound,
  SystemRoleDeletionForbidden,
} from './roles.errors';
import { makeRolesRouterHarness } from './__fixtures__/router-harness';
import { RolesService } from './service';

const VALID_USER_ID = '00000000-0000-4000-a000-000000000001';
const mockRequireSession = vi.fn();
const mockGetOptionalSession = vi.fn();

// `requireSession` / `getOptionalSession` without a real Better Auth layer.
// We return a fixed session; `requirePermission` then consults our stubbed
// `PermissionProvider` (wired via the harness) to decide 200 vs 403.
vi.mock('../../platform/http/session', async () => {
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');
  return {
    requireSession: Effect.suspend(() => mockRequireSession()),
    getOptionalSession: Effect.suspend(() => mockGetOptionalSession()),
  };
});

// Replace the service Tag with an empty-layer test tag so the harness
// can wire in a per-test mock via `Layer.succeed(RolesService, ...)`.
vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');

  return {
    RolesService: Context.GenericTag('@stocket/test/RolesService'),
    rolesLayer: Layer.empty,
  };
});

const ROLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ROLE_ID = '22222222-2222-4222-8222-222222222222';

const makeRoleResponse = (
  overrides: Partial<RoleResponseDto> = {},
): RoleResponseDto =>
  ({
    id: ROLE_ID,
    name: 'Admin',
    description: 'Full access',
    is_system: false,
    permissions: [
      { resource: Resource.ROLES, permission: Permission.READ },
      { resource: Resource.ROLES, permission: Permission.WRITE },
    ],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as RoleResponseDto;

const writeAll = {
  [Resource.ROLES]: [Permission.READ, Permission.WRITE],
};
const readOnly = {
  [Resource.ROLES]: [Permission.READ],
};

const jsonHeaders = { 'content-type': 'application/json' };

describe('rolesRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const session = { user: { id: VALID_USER_ID } };
    mockRequireSession.mockReturnValue(Effect.succeed(session));
    mockGetOptionalSession.mockReturnValue(Effect.succeed(session));
  });

  // -------------------------------------------------------------------
  // GET /roles — list
  // -------------------------------------------------------------------
  describe('GET /roles', () => {
    it('returns 403 when the caller lacks roles:read', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { findAll: () => Effect.succeed([makeRoleResponse()]) },
        permissions: {},
      });

      const response = await handler(new Request('http://localhost/roles'));

      expect(response.status).toBe(403);
    });

    it('returns the role list on success', async () => {
      const findAll = vi.fn(() => Effect.succeed([makeRoleResponse()]));
      const { handler } = makeRolesRouterHarness({
        service: { findAll },
        permissions: readOnly,
      });

      const response = await handler(new Request('http://localhost/roles'));

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: ROLE_ID, name: 'Admin' });
      expect(findAll).toHaveBeenCalledTimes(1);
    });

    it('maps an infrastructure failure to 500', async () => {
      const { handler } = makeRolesRouterHarness({
        service: {
          findAll: () => Effect.die('boom'),
        },
        permissions: readOnly,
      });

      const response = await handler(new Request('http://localhost/roles'));
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /roles/:id — findById
  // -------------------------------------------------------------------
  describe('GET /roles/:id', () => {
    it('rejects without roles:read permission', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { findById: () => Effect.succeed(makeRoleResponse()) },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a valid UUID', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { findById: () => Effect.succeed(makeRoleResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/roles/not-a-uuid'),
      );

      expect(response.status).toBe(400);
    });

    it('returns the role on success', async () => {
      const findById = vi.fn((id: string) =>
        Effect.succeed(makeRoleResponse({ id } as Partial<RoleResponseDto>)),
      );
      const { handler } = makeRolesRouterHarness({
        service: { findById },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: ROLE_ID });
      expect(findById).toHaveBeenCalledWith(ROLE_ID);
    });

    it('maps RoleNotFound → 404', async () => {
      const { handler } = makeRolesRouterHarness({
        service: {
          findById: (id: string) =>
            Effect.fail(new RoleNotFound({ id, messageKey: 'roles.notFound' })),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`),
      );

      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // POST /roles — create (Auditable)
  // -------------------------------------------------------------------
  describe('POST /roles', () => {
    const validBody = {
      name: 'Viewer',
      description: 'Read-only role',
      permissions: [
        { resource: Resource.DASHBOARD, permission: Permission.READ },
      ],
    };

    it('rejects without roles:write permission', async () => {
      const { handler } = makeRolesRouterHarness({
        service: {
          create: () => Effect.succeed(makeRoleResponse()),
        },
        // read-only: guard should reject
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/roles', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { create: () => Effect.succeed(makeRoleResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/roles', {
          method: 'POST',
          headers: jsonHeaders,
          // missing `permissions` field — schema decode should fail
          body: JSON.stringify({ name: 'Viewer' }),
        }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 201 and writes audit on success', async () => {
      const created = makeRoleResponse({ id: OTHER_ROLE_ID, name: 'Viewer' });
      const create = vi.fn(() => Effect.succeed(created));
      const auditLog = vi.fn(() => Effect.void);

      const { handler } = makeRolesRouterHarness({
        service: { create },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/roles', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({
        id: OTHER_ROLE_ID,
        name: 'Viewer',
      });
      expect(create).toHaveBeenCalledTimes(1);

      // Audit: verify *called* with the right shape. We don't await the
      // fire-and-forget log effect — that's covered by AuditLogWriter tests.
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.ROLE,
        entityId: OTHER_ROLE_ID,
      });
    });

    it('maps RoleNameAlreadyExists → 409', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeRolesRouterHarness({
        service: {
          create: () =>
            Effect.fail(
              new RoleNameAlreadyExists({
                name: 'Viewer',
                messageKey: 'roles.nameAlreadyExists',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/roles', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(409);
      // Audit must NOT be fired on failure.
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // PUT /roles/:id — update (Auditable)
  // -------------------------------------------------------------------
  describe('PUT /roles/:id', () => {
    const updateBody = { name: 'Renamed' };

    it('rejects without roles:write permission', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { update: () => Effect.succeed(makeRoleResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails schema decode', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { update: () => Effect.succeed(makeRoleResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          // `name` must be non-empty string
          body: JSON.stringify({ name: '' }),
        }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 200 and writes an UPDATE audit on success', async () => {
      const updated = makeRoleResponse({ name: 'Renamed' });
      const update = vi.fn(() => Effect.succeed(updated));
      const auditLog = vi.fn(() => Effect.void);

      const { handler } = makeRolesRouterHarness({
        service: { update },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ name: 'Renamed' });
      expect(update).toHaveBeenCalledWith(ROLE_ID, { name: 'Renamed' });
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.ROLE,
        entityId: ROLE_ID,
      });
    });

    it('maps RoleNotFound from update → 404', async () => {
      const { handler } = makeRolesRouterHarness({
        service: {
          update: (id: string) =>
            Effect.fail(new RoleNotFound({ id, messageKey: 'roles.notFound' })),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // DELETE /roles/:id — delete (Auditable)
  // -------------------------------------------------------------------
  describe('DELETE /roles/:id', () => {
    it('rejects without roles:write permission', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { delete: () => Effect.void },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makeRolesRouterHarness({
        service: { delete: () => Effect.void },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/roles/bad-id', { method: 'DELETE' }),
      );

      expect(response.status).toBe(400);
    });

    it('returns 200 and fires a DELETE audit on success', async () => {
      const del = vi.fn(() => Effect.void);
      const auditLog = vi.fn(() => Effect.void);

      const { handler } = makeRolesRouterHarness({
        service: { delete: del },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(200);
      expect(del).toHaveBeenCalledWith(ROLE_ID);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.ROLE,
        entityId: ROLE_ID,
      });
    });

    it('maps SystemRoleDeletionForbidden → 400 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeRolesRouterHarness({
        service: {
          delete: (id: string) =>
            Effect.fail(
              new SystemRoleDeletionForbidden({
                id,
                messageKey: 'roles.systemDeletionForbidden',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/roles/${ROLE_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // Static reference so unused-import lint stays quiet: we use RolesService
  // only as a Tag passed to Layer.succeed inside the harness.
  it('has RolesService tag available', () => {
    expect(RolesService).toBeDefined();
  });
});
