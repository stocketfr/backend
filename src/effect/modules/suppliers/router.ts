import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  CreateSupplierSchema,
  SupplierIdSchema,
  SupplierQuerySchema,
  UpdateSupplierSchema,
} from '@stocket/types/suppliers';
import { requirePermission } from '../../platform/auth/authorization';
import { respondJson } from '../../platform/http/errors';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import { makeMessageResponse } from '../../platform/observability/messages';
import { SuppliersService } from './service';

const SupplierPathParams = Schema.Struct({ id: SupplierIdSchema });

export const suppliersRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.SUPPLIERS, Permission.READ);
      const query = yield* HttpServerRequest.schemaSearchParams(SupplierQuerySchema);
      const suppliersService = yield* SuppliersService;
      return yield* respondJson(suppliersService.findAllPaginated(query));
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.SUPPLIERS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(SupplierPathParams);
      const suppliersService = yield* SuppliersService;
      return yield* respondJson(suppliersService.findOne(id));
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.SUPPLIERS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(CreateSupplierSchema);
      const suppliersService = yield* SuppliersService;
      return yield* respondAuditedMutation(suppliersService.create(dto), {
        action: AuditAction.CREATE,
        entityType: AuditEntityType.SUPPLIER,
        entityId: (supplier) => supplier.id,
        responseOptions: { status: 201 },
      });
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.SUPPLIERS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(SupplierPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(UpdateSupplierSchema);
      const suppliersService = yield* SuppliersService;
      return yield* respondAuditedMutation(suppliersService.update(id, dto), {
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.SUPPLIER,
        entityId: id,
      });
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.SUPPLIERS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(SupplierPathParams);
      const suppliersService = yield* SuppliersService;
      return yield* respondAuditedMutation(suppliersService.delete(id), {
        action: AuditAction.DELETE,
        entityType: AuditEntityType.SUPPLIER,
        entityId: id,
        mapResponse: () => makeMessageResponse('suppliers.deleted'),
      });
    }),
  ),
  HttpRouter.prefixAll('/suppliers'),
);
