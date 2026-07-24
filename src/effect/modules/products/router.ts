import { HttpRouter } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  ProductIdSchema,
  ProductQuerySchema,
  ProductBooleanQuerySchema,
  CreateProductRequestSchema,
  UpdateProductRequestSchema,
  BulkCreateProductsSchema,
  BulkUpdateStatusSchema,
  BulkDeleteSchema,
  BulkRestoreSchema,
} from '@stocket/types/products';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  pathParamsAndQueryParams,
  queryParams,
  tenantRoute,
  tenantRouteContext,
} from '../../platform/http/tenant-route';
import { makeMessageResponse } from '../../platform/observability/messages';
import { productImportRouter } from './import/router';
import { ProductsService } from './service';

const ProductPathParams = Schema.Struct({ id: ProductIdSchema });
const CategoryPathParams = Schema.Struct({ categoryId: Schema.UUID });

const IncludeDeletedQuery = Schema.Struct({
  include_deleted: Schema.optionalWith(ProductBooleanQuerySchema, {
    default: () => false,
  }),
});

const PermanentQuery = Schema.Struct({
  permanent: Schema.optionalWith(ProductBooleanQuerySchema, {
    default: () => false,
  }),
});

const ProductLookupQuery = Schema.Struct({
  page: ProductQuerySchema.fields.page,
  limit: ProductQuerySchema.fields.limit,
  search: ProductQuerySchema.fields.search,
  is_active: ProductQuerySchema.fields.is_active,
  sort_by: ProductQuerySchema.fields.sort_by,
  sort_order: ProductQuerySchema.fields.sort_order,
});

export const productsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/all',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: queryParams(ProductQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.get(
    '/',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: queryParams(ProductQuerySchema),
      handler: ({ input: query }) =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findAllPaginated(query),
        ),
    }),
  ),
  HttpRouter.post(
    '/bulk',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: jsonBody(BulkCreateProductsSchema),
      session: 'optional',
    }).pipe(
      Effect.flatMap(({ input: dto, userId }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.bulkCreate(dto, userId),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.PRODUCT,
            entityId: (result) => result.succeeded,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.concat(productImportRouter),
  HttpRouter.get(
    '/category/:categoryId/tree',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: pathParamsAndQueryParams(CategoryPathParams, ProductLookupQuery),
      handler: ({ input: { path, query } }) =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findByCategoryTree(path.categoryId, {
            ...query,
            include_deleted: false,
          }),
        ),
    }),
  ),
  HttpRouter.get(
    '/category/:categoryId',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: pathParamsAndQueryParams(CategoryPathParams, ProductLookupQuery),
      handler: ({ input: { path, query } }) =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findByCategory(path.categoryId, {
            ...query,
            include_deleted: false,
          }),
        ),
    }),
  ),
  HttpRouter.post(
    '/',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: jsonBody(CreateProductRequestSchema),
      session: 'optional',
    }).pipe(
      Effect.flatMap(({ input: dto, userId }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.create(dto, userId),
          ),
          {
            action: AuditAction.CREATE,
            entityType: AuditEntityType.PRODUCT,
            entityId: (result) => result.id,
            responseOptions: { status: 201 },
          },
        ),
      ),
    ),
  ),
  HttpRouter.patch(
    '/bulk/status',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: jsonBody(BulkUpdateStatusSchema),
      session: 'optional',
    }).pipe(
      Effect.flatMap(({ input: dto, userId }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.bulkUpdateStatus(dto, userId),
          ),
          {
            action: AuditAction.STATUS_CHANGE,
            entityType: AuditEntityType.PRODUCT,
            entityId: (result) => result.succeeded,
          },
        ),
      ),
    ),
  ),
  HttpRouter.patch(
    '/bulk/restore',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: jsonBody(BulkRestoreSchema),
    }).pipe(
      Effect.flatMap(({ input: dto }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.bulkRestore(dto),
          ),
          {
            action: AuditAction.RESTORE,
            entityType: AuditEntityType.PRODUCT,
            entityId: (result) => result.succeeded,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/bulk',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: jsonBody(BulkDeleteSchema),
      session: 'optional',
    }).pipe(
      Effect.flatMap(({ input: dto, userId }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.bulkDelete(dto, userId),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.PRODUCT,
            entityId: (result) => result.succeeded,
          },
        ),
      ),
    ),
  ),
  HttpRouter.get(
    '/:id',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: pathParamsAndQueryParams(ProductPathParams, IncludeDeletedQuery),
      handler: ({ input: { path, query } }) =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findOne(path.id, query.include_deleted),
        ),
    }),
  ),
  HttpRouter.put(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: pathParamsAndJsonBody(
        ProductPathParams,
        UpdateProductRequestSchema,
      ),
      session: 'optional',
    }).pipe(
      Effect.flatMap(({ input: { path, body }, userId }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.update(path.id, body, userId),
          ),
          {
            action: AuditAction.UPDATE,
            entityType: AuditEntityType.PRODUCT,
            entityId: path.id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.patch(
    '/:id/restore',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: pathParams(ProductPathParams),
    }).pipe(
      Effect.flatMap(({ input: { id } }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.restore(id),
          ),
          {
            action: AuditAction.RESTORE,
            entityType: AuditEntityType.PRODUCT,
            entityId: id,
          },
        ),
      ),
    ),
  ),
  HttpRouter.del(
    '/:id',
    tenantRouteContext({
      permissions: [[Resource.PRODUCTS, Permission.WRITE]],
      decode: pathParamsAndQueryParams(ProductPathParams, PermanentQuery),
      session: 'optional',
    }).pipe(
      Effect.flatMap(({ input: { path, query }, userId }) =>
        respondAuditedMutation(
          Effect.flatMap(ProductsService, (productsService) =>
            productsService.delete(path.id, userId, query.permanent),
          ),
          {
            action: AuditAction.DELETE,
            entityType: AuditEntityType.PRODUCT,
            entityId: path.id,
            mapResponse: () =>
              makeMessageResponse(
                query.permanent
                  ? 'products.deletedPermanent'
                  : 'products.deleted',
              ),
          },
        ),
      ),
    ),
  ),
  HttpRouter.prefixAll('/products'),
);
