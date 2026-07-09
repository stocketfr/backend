import { Effect } from 'effect';
import {
  type AuditLogResponseDto,
  type PaginatedAuditLogsResponseDto,
  type AuditEntityType,
} from '@stocket/types/audit-logs';
import { toPaginatedResponse } from '@stocket/types/common';
import { makeGetOrFail } from '../../platform/effect/from-null-or';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import type { AuditLogQueryOptions } from './repository';
import {
  AuditLogNotFound,
  type AuditLogsInfrastructureError,
} from './audit-logs.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import { AuditLogsRepository } from './repository';
import { toAuditLogResponseDto } from './mappers';

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
