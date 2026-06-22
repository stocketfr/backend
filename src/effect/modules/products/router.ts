import { readFile } from 'node:fs/promises';
import { HttpRouter, HttpServerRequest, Multipart } from '@effect/platform';
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
import { requirePermission } from '../../platform/auth/authorization';
import { respondJson, respondJsonOk } from '../../platform/http/errors';
import { AuditLogWriter } from '../../platform/audit/index';
import {
  getOptionalSession,
  requireSession,
} from '../../platform/http/session';
import { makeMessageResponse } from '../../platform/observability/messages';
import { ProductImportService } from './import/service';
import {
  ProductImportTypes,
  type ProductImportApprovedPlanDto,
} from './import/types';
import {
  ProductImportCsvParseFailed,
  ProductsInfrastructureError,
} from './products.errors';
import { ProductsService } from './service';

/**
 * `HttpServerRequest.schemaSearchParams` requires `Encoded extends Record<string, string | ...>`
 * with an index signature. Locally-defined `Schema.Struct` types don't carry one, so TS rejects
 * them even though every field encodes to a string at runtime. This helper hides the cast.
 */
const searchParams = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  HttpServerRequest.schemaSearchParams(
    schema as unknown as Schema.Schema<
      A,
      Record<string, string | ReadonlyArray<string> | undefined>,
      R
    >,
  );

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
const ProductImportCategoryMappingSchema = Schema.Struct({
  sourcePath: Schema.String,
  targetCategoryId: Schema.optional(Schema.String),
  targetPath: Schema.String,
  action: Schema.Literal('use-existing', 'create', 'default'),
  rowCount: Schema.Number,
});
const ProductImportSupplierMappingSchema = Schema.Struct({
  sourcePattern: Schema.String,
  supplierName: Schema.String,
  targetSupplierId: Schema.optional(Schema.String),
  action: Schema.Literal('use-existing', 'create', 'ignore'),
  confidence: Schema.Number,
  rowCount: Schema.Number,
});
const ProductImportLocationMappingSchema = Schema.Struct({
  sourceLocation: Schema.String,
  targetLocationId: Schema.optional(Schema.String),
  targetLocationName: Schema.optional(Schema.String),
  areaPath: Schema.optional(Schema.String),
  action: Schema.Literal(
    'use-existing',
    'create-location',
    'create-area',
    'ignore',
  ),
  confidence: Schema.Number,
  rowCount: Schema.Number,
});
const ProductImportApprovedPlanSchema = Schema.Struct({
  skuConflictPolicy: Schema.optional(Schema.Literal('reject', 'derive-sku')),
  allowCreateSuppliers: Schema.optional(Schema.Boolean),
  defaultLocationName: Schema.optional(Schema.String),
  categoryMappings: Schema.optional(
    Schema.Array(ProductImportCategoryMappingSchema),
  ),
  supplierMappings: Schema.optional(
    Schema.Array(ProductImportSupplierMappingSchema),
  ),
  locationMappings: Schema.optional(
    Schema.Array(ProductImportLocationMappingSchema),
  ),
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

const readUploadedProductImportFile = (
  file: Schema.Schema.Type<typeof Multipart.SingleFileSchema>,
) =>
  Effect.tryPromise({
    try: () => readFile(file.path),
    catch: (cause) =>
      new ProductsInfrastructureError({
        action: 'read uploaded product import file',
        cause,
        messageKey: 'products.importReadUploadFailed',
      }),
  });

const planParseFailed = (cause: unknown) =>
  new ProductImportCsvParseFailed({
    cause,
    messageKey: 'products.importCsvParseFailed',
  });

const parseApprovedImportPlan = (plan: string | undefined) => {
  if (!plan) return Effect.succeed(undefined);

  return Effect.try({
    try: () => JSON.parse(plan) as unknown,
    catch: planParseFailed,
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknown(ProductImportApprovedPlanSchema)(value).pipe(
        Effect.mapError(planParseFailed),
      ),
    ),
    Effect.map((value) => value as ProductImportApprovedPlanDto),
  );
};

export const productsRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/all',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const productsService = yield* ProductsService;
      return yield* respondJson(productsService.findAll());
    }),
  ),
  HttpRouter.get(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const query = yield* searchParams(ProductQuerySchema);
      const productsService = yield* ProductsService;
      return yield* respondJson(productsService.findAllPaginated(query));
    }),
  ),
  HttpRouter.post(
    '/bulk',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        BulkCreateProductsSchema,
      );
      const session = yield* getOptionalSession;
      const userId = session?.user.id;
      const productsService = yield* ProductsService;
      const result = yield* productsService.bulkCreate(dto, userId);
      const auditLogWriter = yield* AuditLogWriter;
      if (result.succeeded.length > 0) {
        yield* auditLogWriter.log({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.PRODUCT,
          entityId: result.succeeded[0]!,
        });
      }
      return yield* respondJsonOk(result, { status: 201 });
    }),
  ),
  HttpRouter.post(
    '/import/preview',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
      yield* requirePermission(Resource.SUPPLIERS, Permission.READ);
      const { file, import_type } =
        yield* HttpServerRequest.schemaBodyMultipart(ProductImportUploadSchema);
      const buffer = yield* readUploadedProductImportFile(file);

      const productImportService = yield* ProductImportService;
      const result = yield* productImportService.previewCsvContent({
        content: buffer.toString('utf8'),
        importType: import_type,
      });
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.post(
    '/import/propose',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
      yield* requirePermission(Resource.SUPPLIERS, Permission.READ);
      const { file, import_type } =
        yield* HttpServerRequest.schemaBodyMultipart(ProductImportUploadSchema);
      const buffer = yield* readUploadedProductImportFile(file);

      const productImportService = yield* ProductImportService;
      const result = yield* productImportService.proposeImportPlan({
        content: buffer.toString('utf8'),
        importType: import_type,
      });
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.post(
    '/import',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      yield* requirePermission(Resource.LOCATIONS, Permission.WRITE);
      yield* requirePermission(Resource.INVENTORY, Permission.WRITE);
      const { file, import_type, plan } =
        yield* HttpServerRequest.schemaBodyMultipart(ProductImportUploadSchema);
      const approvedPlan = yield* parseApprovedImportPlan(plan);
      if (approvedPlan?.allowCreateSuppliers) {
        yield* requirePermission(Resource.SUPPLIERS, Permission.WRITE);
      }
      const session = yield* requireSession;
      const userId = session.user.id;

      const buffer = yield* readUploadedProductImportFile(file);

      const productImportService = yield* ProductImportService;
      const result = yield* productImportService.importFromCsvContent({
        content: buffer.toString('utf8'),
        importType: import_type,
        userId,
        approvedPlan,
      });
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.get(
    '/category/:categoryId/tree',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const { categoryId } =
        yield* HttpRouter.schemaPathParams(CategoryPathParams);
      const productsService = yield* ProductsService;
      return yield* respondJson(productsService.findByCategoryTree(categoryId));
    }),
  ),
  HttpRouter.get(
    '/category/:categoryId',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const { categoryId } =
        yield* HttpRouter.schemaPathParams(CategoryPathParams);
      const productsService = yield* ProductsService;
      return yield* respondJson(productsService.findByCategory(categoryId));
    }),
  ),
  HttpRouter.post(
    '/',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        CreateProductRequestSchema,
      );
      const session = yield* getOptionalSession;
      const userId = session?.user.id;
      const productsService = yield* ProductsService;
      const result = yield* productsService.create(dto, userId);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: result.id,
      });
      return yield* respondJsonOk(result, { status: 201 });
    }),
  ),
  HttpRouter.patch(
    '/bulk/status',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        BulkUpdateStatusSchema,
      );
      const session = yield* getOptionalSession;
      const userId = session?.user.id;
      const productsService = yield* ProductsService;
      const result = yield* productsService.bulkUpdateStatus(dto, userId);
      const auditLogWriter = yield* AuditLogWriter;
      if (result.succeeded.length > 0) {
        yield* auditLogWriter.log({
          action: AuditAction.STATUS_CHANGE,
          entityType: AuditEntityType.PRODUCT,
          entityId: result.succeeded[0]!,
        });
      }
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.patch(
    '/bulk/restore',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(BulkRestoreSchema);
      const productsService = yield* ProductsService;
      const result = yield* productsService.bulkRestore(dto);
      const auditLogWriter = yield* AuditLogWriter;
      if (result.succeeded.length > 0) {
        yield* auditLogWriter.log({
          action: AuditAction.RESTORE,
          entityType: AuditEntityType.PRODUCT,
          entityId: result.succeeded[0]!,
        });
      }
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.del(
    '/bulk',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const dto = yield* HttpServerRequest.schemaBodyJson(BulkDeleteSchema);
      const session = yield* getOptionalSession;
      const userId = session?.user.id;
      const productsService = yield* ProductsService;
      const result = yield* productsService.bulkDelete(dto, userId);
      const auditLogWriter = yield* AuditLogWriter;
      if (result.succeeded.length > 0) {
        yield* auditLogWriter.log({
          action: AuditAction.DELETE,
          entityType: AuditEntityType.PRODUCT,
          entityId: result.succeeded[0]!,
        });
      }
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.get(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.READ);
      const { id } = yield* HttpRouter.schemaPathParams(ProductPathParams);
      const query = yield* searchParams(IncludeDeletedQuery);
      const productsService = yield* ProductsService;
      return yield* respondJson(
        productsService.findOne(id, query.include_deleted),
      );
    }),
  ),
  HttpRouter.put(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(ProductPathParams);
      const dto = yield* HttpServerRequest.schemaBodyJson(
        UpdateProductRequestSchema,
      );
      const session = yield* getOptionalSession;
      const userId = session?.user.id;
      const productsService = yield* ProductsService;
      const result = yield* productsService.update(id, dto, userId);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: id,
      });
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.patch(
    '/:id/restore',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(ProductPathParams);
      const productsService = yield* ProductsService;
      const result = yield* productsService.restore(id);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.RESTORE,
        entityType: AuditEntityType.PRODUCT,
        entityId: id,
      });
      return yield* respondJsonOk(result);
    }),
  ),
  HttpRouter.del(
    '/:id',
    Effect.gen(function* () {
      yield* requirePermission(Resource.PRODUCTS, Permission.WRITE);
      const { id } = yield* HttpRouter.schemaPathParams(ProductPathParams);
      const query = yield* searchParams(PermanentQuery);
      const session = yield* getOptionalSession;
      const userId = session?.user.id;
      const productsService = yield* ProductsService;
      yield* productsService.delete(id, userId, query.permanent);
      const auditLogWriter = yield* AuditLogWriter;
      yield* auditLogWriter.log({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.PRODUCT,
        entityId: id,
      });
      return yield* respondJson(
        Effect.succeed(
          makeMessageResponse(
            query.permanent ? 'products.deletedPermanent' : 'products.deleted',
          ),
        ),
      );
    }),
  ),
  HttpRouter.prefixAll('/products'),
);
