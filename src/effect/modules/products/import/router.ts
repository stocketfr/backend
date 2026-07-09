import { readFile } from 'node:fs/promises';
import { HttpRouter, HttpServerRequest, Multipart } from '@effect/platform';
import { Effect, Schema } from 'effect';
import { tenantRoute } from '../../../platform/http/tenant-route';
import { requireProductImportAccess } from '../access';
import {
  ProductImportPlanParseFailed,
  ProductsInfrastructureError,
} from '../products.errors';
import { ProductImportService } from './service';
import { ProductImportPlanSchema, ProductImportTypes } from './types';

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

export const productImportRouter = HttpRouter.empty.pipe(
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
);
