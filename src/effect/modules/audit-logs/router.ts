import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import {
  AuditEntityTypeSchema,
  AuditLogIdSchema,
  AuditLogQuerySchema,
} from '@stocket/types/audit-logs';
import { Permission, Resource } from '@stocket/types/auth';
import { requirePermission } from '../../platform/auth/authorization';
import { respondJson } from '../../platform/http/errors';
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
    Effect.gen(function* () {
      yield* requirePermission(Resource.AUDIT_LOGS, Permission.READ);
      const { entityType, entityId } = yield* HttpRouter.schemaPathParams(
        AuditEntityPathParamsSchema,
      );
      const auditLogsService = yield* AuditLogsService;
      return yield* respondJson(
        auditLogsService.getEntityHistory(entityType, entityId),
      );
    }),
  ),
  HttpRouter.get(
    '/user/:userId',
    Effect.gen(function* () {
      yield* requirePermission(Resource.AUDIT_LOGS, Permission.READ);
      const { userId } = yield* HttpRouter.schemaPathParams(
        AuditUserPathParamsSchema,
      );
      const auditLogsService = yield* AuditLogsService;
      return yield* respondJson(auditLogsService.getUserHistory(userId));
    }),
  ),
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.AUDIT_LOGS, Permission.READ);
      const query =
        yield* HttpServerRequest.schemaSearchParams(AuditLogQuerySchema);
      const auditLogsService = yield* AuditLogsService;
      return yield* respondJson(auditLogsService.query(query));
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.AUDIT_LOGS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(
        AuditLogPathParamsSchema,
      );
      const auditLogsService = yield* AuditLogsService;
      return yield* respondJson(auditLogsService.findById(id));
    }),
  ),
  HttpRouter.prefixAll('/audit-logs'),
);
