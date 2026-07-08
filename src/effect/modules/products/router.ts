import { readFile } from 'node:fs/promises';
import { HttpRouter, HttpServerRequest, Multipart } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { FeatureKey } from '@stocket/types/features';
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
import { requirePermission } from '../../platform/auth/authorization';
import { respondAuditedMutation } from '../../platform/audited-mutation';
import {
  emptyInput,
  jsonBody,
  pathParams,
  pathParamsAndJsonBody,
  pathParamsAndQueryParams,
  queryParams,
  tenantRouteContext,
  tenantRoute,
} from '../../platform/http/tenant-route';
import { makeMessageResponse } from '../../platform/observability/messages';
import { FeaturesService } from '../features/service';
import { ProductImportService } from './import/service';
import { ProductImportPlanSchema, ProductImportTypes } from './import/types';
import {
  ProductImportPlanParseFailed,
  ProductsInfrastructureError,
} from './products.errors';
import { ProductsService } from './service';

const ProductPathParams = Schema.Struct({ id: ProductIdSchema });
const CategoryPathParams = Schema.Struct({ categoryId: Schema.UUID });
const ProductImportTypeSchema = Schema.Literal(...ProductImportTypes);
const ProductImportUploadSchema = Schema.Struct({
  file: Multipart.SingleFileSchema,
  import_type: Schema.optionalWith(ProductImportTypeSchema, {
    default: () => 'auto' as const,
  }),
  plan: Schema.optional(Schema.String),
});

const decodeProductImportPlan = Schema.decodeUnknown(
  Schema.parseJson(ProductImportPlanSchema),
);

const parseProductImportPlan = (plan: string | undefined) =>
  Effect.gen(function* () {
    const trimmed = plan?.trim();
    if (!trimmed) return undefined;

    return yield* decodeProductImportPlan(trimmed).pipe(
      Effect.mapError(
        (cause) =>
          new ProductImportPlanParseFailed({
            cause,
            messageKey: 'products.importPlanParseFailed',
          }),
      ),
    );
  });

const requireSmartImportFeature = Effect.flatMap(FeaturesService, (features) =>
  features.requireFeature(FeatureKey.SMART_IMPORT),
);
const requireProductImportAccess = Effect.gen(function* () {
  yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
  yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
  yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
  yield* requireSmartImportFeature;
});

const readProductImportUpload = Effect.gen(function* () {
  const upload = yield* HttpServerRequest.schemaBodyMultipart(
    ProductImportUploadSchema,
  );
  const buffer = yield* Effect.tryPromise({
    try: () => readFile(upload.file.path),
    catch: (cause) =>
      new ProductsInfrastructureError({
        action: 'read uploaded product import file',
        cause,
        messageKey: 'products.importReadUploadFailed',
      }),
  });

  return {
    content: buffer.toString('utf8'),
    importType: upload.import_type,
    approvedPlan: yield* parseProductImportPlan(upload.plan),
  };
});

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

export const productsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/all',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: emptyInput,
      handler: () =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findAll(),
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
  HttpRouter.post(
    '/import',
    tenantRoute({
      guard: requireProductImportAccess,
      decode: readProductImportUpload,
      session: 'required',
      handler: ({ input: { content, importType, approvedPlan }, session }) =>
        Effect.flatMap(ProductImportService, (productImportService) =>
          session
            ? productImportService.importFromCsvContent({
                content,
                importType,
                approvedPlan,
                userId: session.user.id,
              })
            : Effect.dieMessage('Required session missing for product import'),
        ),
    }),
  ),
  HttpRouter.post(
    '/import/preview',
    tenantRoute({
      guard: requireProductImportAccess,
      decode: readProductImportUpload,
      handler: ({ input: { content, importType } }) =>
        Effect.flatMap(ProductImportService, (productImportService) =>
          productImportService.previewCsvContent({
            content,
            importType,
          }),
        ),
    }),
  ),
  HttpRouter.post(
    '/import/propose',
    tenantRoute({
      guard: requireProductImportAccess,
      decode: readProductImportUpload,
      handler: ({ input: { content, importType } }) =>
        Effect.flatMap(ProductImportService, (productImportService) =>
          productImportService.proposeImportPlan({
            content,
            importType,
          }),
        ),
    }),
  ),
  HttpRouter.get(
    '/category/:categoryId/tree',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: pathParams(CategoryPathParams),
      handler: ({ input: { categoryId } }) =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findByCategoryTree(categoryId),
        ),
    }),
  ),
  HttpRouter.get(
    '/category/:categoryId',
    tenantRoute({
      permissions: [[Resource.PRODUCTS, Permission.READ]],
      decode: pathParams(CategoryPathParams),
      handler: ({ input: { categoryId } }) =>
        Effect.flatMap(ProductsService, (productsService) =>
          productsService.findByCategory(categoryId),
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
      decode: pathParamsAndJsonBody(ProductPathParams, UpdateProductRequestSchema),
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
