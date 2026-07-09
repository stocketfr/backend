import { Effect } from 'effect';
import { TenantNotFound } from './superadmin.errors';
import type {
  PlatformAuditEventInput,
  SuperAdminActor,
  TenantListRow,
} from './types';

export interface DeleteTenantRepository {
  readonly deleteTenant: (
    tenantId: string,
  ) => Effect.Effect<TenantListRow | null, unknown>;
  readonly recordPlatformAuditEvent: (
    input: PlatformAuditEventInput,
  ) => Effect.Effect<unknown, unknown>;
}

interface DeleteTenantWorkflowOptions {
  readonly repository: DeleteTenantRepository;
  readonly invalidateTenant: (
    tenantId: string,
  ) => Effect.Effect<unknown, unknown>;
}

export const makeDeleteTenantWorkflow = ({
  repository,
  invalidateTenant,
}: DeleteTenantWorkflowOptions) => {
  const deleteTenant = (tenantId: string, actor: SuperAdminActor) =>
    Effect.gen(function* () {
      const deleted = yield* repository.deleteTenant(tenantId);
      if (!deleted) {
        return yield* Effect.fail(
          new TenantNotFound({
            tenantId,
            messageKey: 'superadmin.tenantNotFound',
          }),
        );
      }

      yield* invalidateTenant(tenantId);
      yield* Effect.forkDaemon(
        repository
          .recordPlatformAuditEvent({
            actorUserId: actor.userId,
            action: 'tenant.delete',
            entityType: 'tenant',
            entityId: deleted.id,
            metadata: {
              name: deleted.name,
              slug: deleted.slug,
              primaryHostname: deleted.primaryHostname,
            },
            ipAddress: actor.ipAddress ?? null,
            userAgent: actor.userAgent ?? null,
          })
          .pipe(Effect.ignore),
      );
    });

  return { deleteTenant };
};
