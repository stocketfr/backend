import { readFile } from 'node:fs/promises';
import {
  Headers,
  HttpRouter,
  HttpServerRequest,
  Multipart,
} from '@effect/platform';
import { Effect, Option, Schema } from 'effect';
import { respondJsonOk } from '../../../platform/http/errors';
import {
  tenantRoute,
  tenantRouteContext,
} from '../../../platform/http/tenant-route';
import { requireProductImportAccess } from '../access';
import {
  ProductImportGuidanceParseFailed,
  ProductImportPlanParseFailed,
  ProductsInfrastructureError,
} from '../products.errors';
import { ProductImportService } from './service';
import { ProductImportBackgroundService } from './background/service';
import {
  ProductImportPlanSchema,
  ProductImportProposalGuidanceSchema,
  ProductImportTypes,
} from './types';

const ProductImportTypeSchema = Schema.Literal(...ProductImportTypes);
const ProductImportIdempotencyKeySchema = Schema.Trim.pipe(
  Schema.nonEmptyString(),
  Schema.maxLength(200),
);
const ProductImportUploadSchema = Schema.Struct({
  file: Multipart.SingleFileSchema,
  import_type: Schema.optionalWith(ProductImportTypeSchema, {
    default: () => 'auto' as const,
  }),
  plan: Schema.optional(Schema.String),
  guidance: Schema.optional(Schema.String),
});

const decodeProductImportPlan = Schema.decodeUnknown(
  Schema.parseJson(ProductImportPlanSchema),
);
const decodeProductImportGuidance = Schema.decodeUnknown(
  Schema.parseJson(ProductImportProposalGuidanceSchema),
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

const parseProductImportGuidance = (guidance: string | undefined) =>
  Effect.gen(function* () {
    const trimmed = guidance?.trim();
    if (!trimmed) return undefined;

    return yield* decodeProductImportGuidance(trimmed).pipe(
      Effect.mapError(
        (cause) =>
          new ProductImportGuidanceParseFailed({
            cause,
            messageKey: 'products.importGuidanceParseFailed',
          }),
      ),
    );
  });

const readProductImportUpload = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const idempotencyKeyHeader = Headers.get(request.headers, 'idempotency-key');
  const idempotencyKey = Option.isSome(idempotencyKeyHeader)
    ? yield* Schema.decodeUnknown(ProductImportIdempotencyKeySchema)(
        idempotencyKeyHeader.value,
      )
    : undefined;
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
    bytes: buffer,
    importType: upload.import_type,
    approvedPlan: yield* parseProductImportPlan(upload.plan),
    guidance: upload.guidance,
    idempotencyKey,
  };
});

export const productImportRouter = HttpRouter.empty.pipe(
  HttpRouter.post(
    '/import',
    tenantRouteContext({
      guard: requireProductImportAccess,
      decode: readProductImportUpload,
      session: 'required',
    }).pipe(
      Effect.flatMap(
        ({
          input: { bytes, importType, approvedPlan, idempotencyKey },
          session,
        }) =>
          session
            ? Effect.flatMap(
                ProductImportBackgroundService,
                (backgroundImport) =>
                  backgroundImport.enqueue({
                    bytes,
                    importType,
                    approvedPlan,
                    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
                    userId: session.user.id,
                  }),
              )
            : Effect.dieMessage('Required session missing for product import'),
      ),
      Effect.flatMap((task) =>
        respondJsonOk(task, {
          status: 202,
          headers: { Location: `/api/v1/tasks/${task.id}` },
        }),
      ),
    ),
  ),
  HttpRouter.post(
    '/import/preview',
    tenantRoute({
      guard: requireProductImportAccess,
      decode: readProductImportUpload,
      handler: ({ input: { bytes, importType } }) =>
        Effect.flatMap(ProductImportService, (productImportService) =>
          productImportService.previewCsvContent({
            content: bytes.toString('utf8'),
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
      handler: ({ input: { bytes, importType, guidance } }) =>
        Effect.gen(function* () {
          const productImportService = yield* ProductImportService;
          const parsedGuidance = yield* parseProductImportGuidance(guidance);
          return yield* productImportService.proposeImportPlan({
            content: bytes.toString('utf8'),
            importType,
            guidance: parsedGuidance,
          });
        }),
    }),
  ),
);
