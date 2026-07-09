import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  CreateSupplierSchema,
  SupplierIdSchema,
  SupplierQuerySchema,
  UpdateSupplierSchema,
} from '@stocket/types/suppliers';
import { makeMessageResponse } from '../../platform/observability/messages';
import {
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  queryParams,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { SuppliersService } from './service';

const SupplierPathParams = Schema.Struct({ id: SupplierIdSchema });

export const suppliersRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.SUPPLIERS, Permission.READ]],
      decode: queryParams(SupplierQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(SuppliersService, (suppliersService) =>
          suppliersService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.SUPPLIERS, Permission.READ]],
      decode: pathParams(SupplierPathParams),
      handler: ({ input: { id } }) =>
        Effect.flatMap(SuppliersService, (suppliersService) =>
          suppliersService.findOne(id),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.SUPPLIERS, Permission.WRITE]],
      decode: jsonBody(CreateSupplierSchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(SuppliersService, (suppliersService) =>
            suppliersService.create(dto),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.SUPPLIER,
            entityId: (supplier) => supplier.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.SUPPLIERS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(SupplierPathParams, UpdateSupplierSchema),
    }).pipe(
      Effect.flatMap(({ input: { path, body } }) =>
        respondAuditedMutation(
          Effect.flatMap(SuppliersService, (suppliersService) =>
            suppliersService.update(path.id, body),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.SUPPLIER,
            entityId: ({ id }) => id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.SUPPLIERS, Permission.WRITE]],
      decode: pathParams(SupplierPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(SuppliersService, (suppliersService) =>
            suppliersService.delete(id),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.SUPPLIER,
            entityId: id,
            mapResponse: () => makeMessageResponse('suppliers.deleted'),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/suppliers'),
);
