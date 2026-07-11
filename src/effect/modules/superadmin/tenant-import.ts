import { Effect } from 'effect';
import type {
  ProductImportPreviewDto,
  ProductImportResultDto,
} from '@stocket/types/products';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../platform/http/request-context';
import { TenantImportInvalid } from './superadmin.errors';
import type { CreateTenantActor, CreateTenantProductImport } from './types';

export interface TenantImportProductService<R = never> {
  readonly previewCsvContent: (input: {
    readonly content: string;
  }) => Effect.Effect<ProductImportPreviewDto, unknown, R>;
  readonly importFromCsvContent: (input: {
    readonly content: string;
    readonly userId: string;
  }) => Effect.Effect<ProductImportResultDto, unknown, R>;
}

export interface CreatedTenantForImport {
  readonly tenant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  };
  readonly admin: { readonly id: string };
}

export const makeTenantImportInvalid = (details: string, cause?: unknown) =>
  new TenantImportInvalid({
    details,
    cause,
    messageKey: 'superadmin.tenantImportInvalid',
    messageArgs: { details },
  });

export const formatImportCause = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim() !== '') {
    return cause.message;
  }

  if (
    cause !== null &&
    typeof cause === 'object' &&
    !Array.isArray(cause) &&
    'message' in cause &&
    typeof cause.message === 'string' &&
    cause.message.trim() !== ''
  ) {
    return cause.message;
  }

  return 'Product import failed.';
};

export const formatPreviewErrors = (preview: ProductImportPreviewDto) => {
  const rowErrors = preview.inventoryPreviews
    .filter(
      (item) =>
        item.reason === 'Missing SKU or name' || item.action === 'conflict',
    )
    .map((item) => `Row ${item.row}: ${item.reason ?? item.action}`);

  if (rowErrors.length > 0) {
    return rowErrors.join('; ');
  }

  return preview.warnings
    .filter((warning) => warning.severity === 'error')
    .map((warning) => warning.message)
    .join('; ');
};

export const formatImportResultErrors = (result: ProductImportResultDto) =>
  result.errors
    .filter((error) => !error.error.startsWith('Photo import failed for "'))
    .map((error) => `Row ${error.row}: ${error.error}`)
    .join('; ');

export const tenantImportRequestContext = (
  actor: CreateTenantActor,
  created: CreatedTenantForImport,
): RequestContext => ({
  requestId:
    actor.requestContext?.requestId ??
    `00000000-0000-4000-8000-${created.tenant.id.slice(-12)}`,
  path: actor.requestContext?.path ?? '/api/v1/superadmin/tenants',
  method: actor.requestContext?.method ?? 'POST',
  ip: actor.ipAddress ?? actor.requestContext?.ip ?? null,
  locale: actor.requestContext?.locale ?? 'en',
  tenantId: created.tenant.id,
  tenantName: created.tenant.name,
  tenantSlug: created.tenant.slug,
});

export const validateProductImport = <R>(
  productImport: CreateTenantProductImport,
  productImportService: Pick<
    TenantImportProductService<R>,
    'previewCsvContent'
  >,
) =>
  productImportService
    .previewCsvContent({ content: productImport.content })
    .pipe(
      Effect.mapError((cause) =>
        makeTenantImportInvalid(formatImportCause(cause), cause),
      ),
      Effect.flatMap((preview) => {
        const details = formatPreviewErrors(preview);
        if (details) {
          return Effect.fail(makeTenantImportInvalid(details, preview));
        }
        return Effect.succeed(productImport);
      }),
    );

export const importProductsForTenant = <R>(
  created: CreatedTenantForImport,
  productImport: CreateTenantProductImport,
  actor: CreateTenantActor,
  productImportService: Pick<
    TenantImportProductService<R>,
    'importFromCsvContent'
  >,
) =>
  productImportService
    .importFromCsvContent({
      content: productImport.content,
      userId: created.admin.id,
    })
    .pipe(
      Effect.provideService(
        CurrentRequestContext,
        tenantImportRequestContext(actor, created),
      ),
      Effect.mapError((cause) =>
        makeTenantImportInvalid(formatImportCause(cause), cause),
      ),
      Effect.flatMap((result) => {
        const details = formatImportResultErrors(result);
        if (details) {
          return Effect.fail(makeTenantImportInvalid(details, result));
        }
        return Effect.succeed(result);
      }),
    );
