import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import {
  makeDeleteTenantWorkflow,
  type DeleteTenantRepository,
} from './delete-tenant';
import type { PlatformAuditEventInput, TenantListRow } from './types';

const tenantId = '00000000-0000-4000-8000-000000000101';
const deletedTenant: TenantListRow = {
  id: tenantId,
  name: 'Acme France',
  slug: 'acme',
  primaryHostname: 'acme.localhost:3000',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

const actor = {
  userId: 'superadmin-1',
  ipAddress: '127.0.0.1',
  userAgent: 'vitest',
};

const makeRepository = (
  overrides: Partial<DeleteTenantRepository> = {},
): DeleteTenantRepository => ({
  deleteTenant: () => Effect.succeed(deletedTenant),
  recordPlatformAuditEvent: () => Effect.void,
  ...overrides,
});

describe('makeDeleteTenantWorkflow', () => {
  it.live(
    'deletes a tenant, invalidates features, and records platform audit',
    () =>
      Effect.gen(function* () {
        let deletedTenantId: string | undefined;
        let invalidatedTenantId: string | undefined;
        let auditInput: PlatformAuditEventInput | undefined;
        const workflow = makeDeleteTenantWorkflow({
          repository: makeRepository({
            deleteTenant: (id) =>
              Effect.sync(() => {
                deletedTenantId = id;
                return deletedTenant;
              }),
            recordPlatformAuditEvent: (input) =>
              Effect.sync(() => {
                auditInput = input;
              }),
          }),
          invalidateTenant: (id) =>
            Effect.sync(() => {
              invalidatedTenantId = id;
            }),
        });

        yield* workflow.deleteTenant(tenantId, actor);
        yield* Effect.sleep('1 millis');

        expect(deletedTenantId).toBe(tenantId);
        expect(invalidatedTenantId).toBe(tenantId);
        expect(auditInput).toEqual({
          actorUserId: 'superadmin-1',
          action: 'tenant.delete',
          entityType: 'tenant',
          entityId: tenantId,
          metadata: {
            name: 'Acme France',
            slug: 'acme',
            primaryHostname: 'acme.localhost:3000',
          },
          ipAddress: '127.0.0.1',
          userAgent: 'vitest',
        });
      }),
  );

  it.effect('fails with TenantNotFound before invalidating or auditing', () =>
    Effect.gen(function* () {
      let invalidated = false;
      let audited = false;
      const workflow = makeDeleteTenantWorkflow({
        repository: makeRepository({
          deleteTenant: () => Effect.succeed(null),
          recordPlatformAuditEvent: () =>
            Effect.sync(() => {
              audited = true;
            }),
        }),
        invalidateTenant: () =>
          Effect.sync(() => {
            invalidated = true;
          }),
      });

      const error = yield* Effect.flip(workflow.deleteTenant(tenantId, actor));

      expect(error).toMatchObject({
        _tag: 'TenantNotFound',
        tenantId,
      });
      expect(invalidated).toBe(false);
      expect(audited).toBe(false);
    }),
  );
});
