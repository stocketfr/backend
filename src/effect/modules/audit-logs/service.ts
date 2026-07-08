import { Effect } from 'effect';
import {
  type AuditLogResponseDto,
  type PaginatedAuditLogsResponseDto,
  type AuditEntityType,
} from '@stocket/types/audit-logs';
import { toPaginatedResponse } from '@stocket/types/common';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import type { auditLogs } from '../../platform/db/schema';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import type { AuditLogQueryOptions, AuditLogRowWithUser } from './repository';
import {
  AuditLogNotFound,
  type AuditLogsInfrastructureError,
} from './audit-logs.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { AuditLogsRepository } from './repository';

type AuditLog = typeof auditLogs.$inferSelect | AuditLogRowWithUser;

const toAuditLogResponseDto = (auditLog: AuditLog): AuditLogResponseDto => ({
  id: auditLog.id,
  user_id: auditLog.user_id,
  user_name: 'user_name' in auditLog ? auditLog.user_name : null,
  action: auditLog.action,
  entity_type: auditLog.entity_type,
  entity_id: auditLog.entity_id,
  changes: auditLog.changes as AuditLogResponseDto['changes'],
  user_agent: auditLog.user_agent,
  created_at: auditLog.created_at,
});

export class AuditLogsService extends Effect.Service<AuditLogsService>()(
  '@stocket/effect/audit-logs/AuditLogsService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* AuditLogsRepository;
      const trace = makeServiceTracer({
        serviceName: 'AuditLogsService',
        module: 'audit-logs',
        layer: 'service',
      });

      const findOrFail = makeGetOrFail(
        (id: string) => repository.findById(id),
        (id) => new AuditLogNotFound({ id, messageKey: 'auditLogs.notFound' }),
      );

      const getAuditLogOrFail = (id: string) =>
        Effect.map(findOrFail(id), toAuditLogResponseDto);

      const query = (
        queryOptions: AuditLogQueryOptions,
      ): Effect.Effect<
        PaginatedAuditLogsResponseDto,
        AuditLogsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findPaginated(queryOptions), (result) =>
          toPaginatedResponse(result, toAuditLogResponseDto),
        ).pipe(trace.span('query'));

      const findById = (
        id: string,
      ): Effect.Effect<
        AuditLogResponseDto,
        AuditLogsInfrastructureError | AuditLogNotFound | TenantNotResolved
      > =>
        getAuditLogOrFail(id).pipe(
          trace.span('findById', { attributes: { id } }),
        );

      const getEntityHistory = (
        entityType: AuditEntityType,
        entityId: string,
      ): Effect.Effect<
        AuditLogResponseDto[],
        AuditLogsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(
          repository.findByEntityId(entityType, entityId),
          (auditLogs) => auditLogs.map(toAuditLogResponseDto),
        ).pipe(
          trace.span('getEntityHistory', {
            attributes: { entityId },
          }),
        );

      const getUserHistory = (
        userId: string,
      ): Effect.Effect<
        AuditLogResponseDto[],
        AuditLogsInfrastructureError | TenantNotResolved
      > =>
        Effect.map(repository.findByUserId(userId), (auditLogs) =>
          auditLogs.map(toAuditLogResponseDto),
        ).pipe(
          trace.span('getUserHistory', {
            attributes: { userId },
          }),
        );

      return { query, findById, getEntityHistory, getUserHistory };
    }),
    dependencies: [AuditLogsRepository.Default],
  },
) {}
