import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import {
  AuditEntityTypeSchema,
  AuditLogIdSchema,
  AuditLogQuerySchema,
} from '@stocket/types/audit-logs';
import { Permission, Resource } from '@stocket/types/auth';
import {
  pathParams,
  queryParams,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { AuditLogsService } from './service';

const AuditLogPathParamsSchema = Schema.Struct({
  id: AuditLogIdSchema,
});

const AuditEntityPathParamsSchema = Schema.Struct({
  entityType: AuditEntityTypeSchema,
  entityId: AuditLogIdSchema,
});

const AuditUserPathParamsSchema = Schema.Struct({
  userId: AuditLogIdSchema,
});

export const auditLogsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/entity/:entityType/:entityId',
    tenantRoute({
      permissions: [[Resource.AUDIT_LOGS, Permission.READ]],
      decode: pathParams(AuditEntityPathParamsSchema),
      handler: ({ input: { entityType, entityId } }) =>
        Effect.flatMap(AuditLogsService, (auditLogsService) =>
          auditLogsService.getEntityHistory(entityType, entityId),
        ),
    }),
  ),
  HttpRouter.get(
    '/user/:userId',
    tenantRoute({
      permissions: [[Resource.AUDIT_LOGS, Permission.READ]],
      decode: pathParams(AuditUserPathParamsSchema),
      handler: ({ input: { userId } }) =>
        Effect.flatMap(AuditLogsService, (auditLogsService) =>
          auditLogsService.getUserHistory(userId),
        ),
    }),
  ),
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.AUDIT_LOGS, Permission.READ]],
      decode: queryParams(AuditLogQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(AuditLogsService, (auditLogsService) =>
          auditLogsService.query(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.AUDIT_LOGS, Permission.READ]],
      decode: pathParams(AuditLogPathParamsSchema),
      handler: ({ input: { id } }) =>
        Effect.flatMap(AuditLogsService, (auditLogsService) =>
          auditLogsService.findById(id),
        ),
    }),
  ),
  HttpRouter.prefixAll('/audit-logs'),
);
