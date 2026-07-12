import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import type {
  ProductImportPreviewDto,
  ProductImportResultDto,
} from '@stocket/types/products';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../platform/http/request-context';
import {
  formatImportCause,
  formatImportResultErrors,
  formatPreviewErrors,
  importProductsForTenant,
  tenantImportRequestContext,
  validateProductImport,
  type CreatedTenantForImport,
  type TenantImportProductService,
} from './tenant-import';
import type { CreateTenantActor, CreateTenantProductImport } from './types';

const productImport: CreateTenantProductImport = {
  filename: 'products.csv',
  content: 'sku,name\nSKU-1,Whisky\n',
};

const created: CreatedTenantForImport = {
  tenant: {
    id: '00000000-0000-4000-8000-123456789abc',
    name: 'Tenant Name',
    slug: 'tenant-name',
  },
  admin: { id: 'admin-1' },
};

const actor: CreateTenantActor = {
  userId: 'superadmin-1',
  ipAddress: '203.0.113.10',
  userAgent: 'Vitest',
};

const preview = (
  overrides: Partial<ProductImportPreviewDto> = {},
): ProductImportPreviewDto => ({
  format: 'normalized-products',
  totalRows: 1,
  itemRows: 1,
  folderRows: 0,
  photoUrlCount: 0,
  importableRows: 1,
  missingRequiredRows: 0,
  duplicateSkuConflicts: [],
  categoryMappings: [],
  supplierMappings: [],
  locationMappings: [],
  inventoryPreviews: [],
  warnings: [],
  ...overrides,
});

const importResult = (
  overrides: Partial<ProductImportResultDto> = {},
): ProductImportResultDto => ({
  categoriesCreated: 0,
  locationsCreated: 0,
  areasCreated: 0,
  productsCreated: 1,
  productsUpdated: 0,
  inventoryRecordsCreated: 1,
  inventoryRecordsUpdated: 0,
  photosCreated: 0,
  photosSkipped: 0,
  rowsSkipped: 0,
  errors: [],
  ...overrides,
});

describe('tenant import helpers', () => {
  it('formats import causes from errors, message objects, and unknown values', () => {
    expect(formatImportCause(new Error('CSV parse failed'))).toBe(
      'CSV parse failed',
    );
    expect(formatImportCause({ message: 'Unsupported format' })).toBe(
      'Unsupported format',
    );
    expect(formatImportCause({ message: '   ' })).toBe(
      'Product import failed.',
    );
    expect(formatImportCause(null)).toBe('Product import failed.');
  });

  it('formats preview row errors before warning errors', () => {
    expect(
      formatPreviewErrors(
        preview({
          inventoryPreviews: [
            {
              row: 2,
              sku: '',
              location: '',
              quantity: 0,
              action: 'skip',
              reason: 'Missing SKU or name',
            },
            {
              row: 4,
              sku: 'SKU-4',
              location: 'Warehouse',
              quantity: 1,
              action: 'conflict',
            },
          ],
          warnings: [
            {
              severity: 'error',
              message: 'This warning is lower priority here.',
            },
          ],
        }),
      ),
    ).toBe('Row 2: Missing SKU or name; Row 4: conflict');
  });

  it('formats preview warning errors when row errors are absent', () => {
    expect(
      formatPreviewErrors(
        preview({
          warnings: [
            { severity: 'warning', message: 'Non-blocking warning' },
            { severity: 'error', message: 'Blocking warning' },
          ],
        }),
      ),
    ).toBe('Blocking warning');
  });

  it('formats import result row errors', () => {
    expect(
      formatImportResultErrors(
        importResult({
          errors: [
            { row: 3, error: 'Invalid quantity' },
            { row: 5, error: 'Missing product name' },
          ],
        }),
      ),
    ).toBe('Row 3: Invalid quantity; Row 5: Missing product name');
  });

  it('keeps post-commit photo failures nonblocking', () => {
    expect(
      formatImportResultErrors(
        importResult({
          photosSkipped: 1,
          errors: [
            {
              row: 2,
              error:
                'Photo import failed for "https://example.test/photo.jpg": network down',
            },
          ],
        }),
      ),
    ).toBe('');
  });

  it('builds tenant-scoped request context for import execution', () => {
    expect(tenantImportRequestContext(actor, created)).toEqual({
      requestId: '00000000-0000-4000-8000-123456789abc',
      path: '/api/v1/superadmin/tenants',
      method: 'POST',
      ip: '203.0.113.10',
      locale: 'en',
      tenantId: created.tenant.id,
      tenantName: created.tenant.name,
      tenantSlug: created.tenant.slug,
    });
  });

  it.effect('validates a clean product import preview', () =>
    Effect.gen(function* () {
      const service: Pick<TenantImportProductService, 'previewCsvContent'> = {
        previewCsvContent: () => Effect.succeed(preview()),
      };

      const result = yield* validateProductImport(productImport, service);

      expect(result).toBe(productImport);
    }),
  );

  it.effect('fails validation when preview has blocking errors', () =>
    Effect.gen(function* () {
      const service: Pick<TenantImportProductService, 'previewCsvContent'> = {
        previewCsvContent: () =>
          Effect.succeed(
            preview({
              warnings: [
                {
                  severity: 'error',
                  message: 'Missing required fields.',
                },
              ],
            }),
          ),
      };

      const error = yield* Effect.flip(
        validateProductImport(productImport, service),
      );

      expect(error).toMatchObject({
        _tag: 'TenantImportInvalid',
        details: 'Missing required fields.',
      });
    }),
  );

  it.effect('imports products with a tenant request context', () =>
    Effect.gen(function* () {
      const service: Pick<
        TenantImportProductService<RequestContext>,
        'importFromCsvContent'
      > = {
        importFromCsvContent: (input) =>
          Effect.gen(function* () {
            expect(input).toEqual({
              content: productImport.content,
              userId: created.admin.id,
            });

            const context = yield* CurrentRequestContext;
            expect(context.tenantId).toBe(created.tenant.id);
            expect(context.tenantSlug).toBe(created.tenant.slug);

            return importResult();
          }),
      };

      const result = yield* importProductsForTenant(
        created,
        productImport,
        actor,
        service,
      );

      expect(result.productsCreated).toBe(1);
    }),
  );

  it.effect(
    'fails product import when the import result contains row errors',
    () =>
      Effect.gen(function* () {
        const service: Pick<
          TenantImportProductService,
          'importFromCsvContent'
        > = {
          importFromCsvContent: () =>
            Effect.succeed(
              importResult({
                errors: [{ row: 2, error: 'Invalid SKU' }],
              }),
            ),
        };

        const error = yield* Effect.flip(
          importProductsForTenant(created, productImport, actor, service),
        );

        expect(error).toMatchObject({
          _tag: 'TenantImportInvalid',
          details: 'Row 2: Invalid SKU',
        });
      }),
  );

  it.effect('accepts product imports with only photo warnings', () =>
    Effect.gen(function* () {
      const service: Pick<TenantImportProductService, 'importFromCsvContent'> =
        {
          importFromCsvContent: () =>
            Effect.succeed(
              importResult({
                photosSkipped: 1,
                errors: [
                  {
                    row: 2,
                    error:
                      'Photo import failed for "https://example.test/photo.jpg": network down',
                  },
                ],
              }),
            ),
        };

      const result = yield* importProductsForTenant(
        created,
        productImport,
        actor,
        service,
      );

      expect(result.photosSkipped).toBe(1);
      expect(result.errors).toHaveLength(1);
    }),
  );
});
