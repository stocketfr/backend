/**
 * Unit-scope tests for `productsRouter`.
 *
 * Scope: HTTP boundary only — guard → decode → service → respond. Service
 * internals live in `service.effect.spec.ts` / `service.integration.spec.ts`.
 *
 * Canonical coverage per route:
 *   1. Permission guard rejects insufficient role → 403
 *   2. Decode failure on malformed body / params → 400
 *   3. Service success → correct status + payload shape
 *   4. Service tagged error → mapped HTTP status (404, 400, 500).
 *      SkuAlreadyExists and PriceBelowCost currently map to 400.
 *
 * Mutations are `@Auditable`. The audit writer is fire-and-forget, so we
 * verify it's *called* via a spy — we do not couple to whether its
 * downstream effect succeeds.
 *
 * This router has 13 routes; individual bulk/GET/category routes share
 * their permission-guard / decode / service-success / service-error
 * patterns, so a handful of lower-risk redundancy-only 4th-tests have
 * been omitted. Every route still has the core three (guard + success +
 * error or decode) at minimum; where a decode path exists it's
 * explicitly exercised.
 */
import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  CategoryNotFound,
  PriceBelowCost,
  ProductNotDeleted,
  ProductNotFound,
  ProductsInfrastructureError,
  SkuAlreadyExists,
} from './products.errors';
import { makeProductsRouterHarness } from './__fixtures__/router-harness';
import { ProductsService } from './service';

const mockMultipart = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());

vi.mock('@effect/platform', async () => {
  const actual =
    await vi.importActual<typeof import('@effect/platform')>(
      '@effect/platform',
    );
  const { Effect } = await vi.importActual<typeof import('effect')>('effect');

  return {
    ...actual,
    HttpServerRequest: {
      ...actual.HttpServerRequest,
      schemaBodyMultipart: (_schema: unknown) =>
        Effect.suspend(() => mockMultipart()),
    },
  };
});

vi.mock('node:fs/promises', async () => {
  const actual =
    await vi.importActual<typeof import('node:fs/promises')>(
      'node:fs/promises',
    );
  return {
    ...actual,
    readFile: (...args: unknown[]) => mockReadFile(...args),
  };
});

vi.mock('./service', async () => {
  const { Context, Layer } =
    await vi.importActual<typeof import('effect')>('effect');
  return {
    ProductsService: Context.GenericTag('@stocket/test/ProductsService'),
    productsLayer: Layer.empty,
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PRODUCT_ID = '22222222-2222-4222-8222-222222222222';
const CATEGORY_ID = '33333333-3333-4333-8333-333333333333';

const makeProductResponse = (overrides: Record<string, unknown> = {}) => ({
  id: PRODUCT_ID,
  sku: 'SKU-1',
  name: 'Whisky',
  description: null,
  category_id: CATEGORY_ID,
  volume_ml: null,
  weight_kg: null,
  dimensions_cm: null,
  standard_cost: null,
  standard_price: null,
  markup_percentage: null,
  reorder_point: 10,
  primary_supplier_id: null,
  supplier_sku: null,
  barcode: null,
  unit: null,
  is_active: true,
  is_perishable: false,
  notes: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  deleted_at: null,
  created_by: null,
  updated_by: null,
  deleted_by: null,
  ...overrides,
});

const bulkResult = (
  overrides: Partial<{
    succeeded: string[];
    failures: unknown[];
    success_count: number;
    failure_count: number;
  }> = {},
) => ({
  succeeded: [PRODUCT_ID],
  failures: [],
  success_count: 1,
  failure_count: 0,
  ...overrides,
});

const importResult = () => ({
  categoriesCreated: 1,
  locationsCreated: 1,
  areasCreated: 0,
  productsCreated: 1,
  productsUpdated: 0,
  inventoryRecordsCreated: 1,
  inventoryRecordsUpdated: 0,
  photosCreated: 0,
  photosSkipped: 0,
  rowsSkipped: 0,
  errors: [],
});

const importPreview = () => ({
  format: 'sortly-items',
  totalRows: 2,
  itemRows: 1,
  folderRows: 1,
  importableRows: 1,
  missingRequiredRows: 0,
  duplicateSkuConflicts: [],
  categoryMappings: [],
  supplierMappings: [],
  locationMappings: [],
  inventoryPreviews: [],
  warnings: [],
});

const importProposal = () => ({
  format: 'sortly-items',
  confidence: 0.84,
  productIdentity: {
    sourceColumn: 'SID',
    conflictPolicy: 'reject',
  },
  categoryMappings: [],
  supplierMappings: [],
  locationMappings: [],
  warnings: [],
});

const makePersistedFile = (overrides: Record<string, unknown> = {}) => ({
  _tag: 'PersistedFile' as const,
  key: 'file',
  name: 'products.csv',
  contentType: 'text/csv',
  path: '/tmp/products-import.csv',
  ...overrides,
});

const validCreateBody = {
  sku: 'SKU-1',
  name: 'Whisky',
  category_id: CATEGORY_ID,
  reorder_point: 10,
  is_active: true,
  is_perishable: false,
};

const writeAll = {
  [Resource.PRODUCTS]: [Permission.READ, Permission.WRITE],
  [Resource.LOCATIONS]: [Permission.READ, Permission.WRITE],
  [Resource.INVENTORY]: [Permission.READ, Permission.WRITE],
};
const readOnly = {
  [Resource.PRODUCTS]: [Permission.READ],
};
const productsWriteOnly = {
  [Resource.PRODUCTS]: [Permission.READ, Permission.WRITE],
};

const jsonHeaders = { 'content-type': 'application/json' };

describe('productsRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(
      Buffer.from('sku,name,category_path\nSKU-1,Whisky,Spirits\n'),
    );
  });

  // -------------------------------------------------------------------
  // GET /products/all
  // -------------------------------------------------------------------
  describe('GET /products/all', () => {
    it('rejects without PRODUCTS:read permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findAll: () => Effect.succeed([makeProductResponse()]) },
        permissions: {},
      });

      const response = await handler(
        new Request('http://localhost/products/all'),
      );
      expect(response.status).toBe(403);
    });

    it('returns 401 when the session is absent', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findAll: () => Effect.succeed([]) },
        permissions: readOnly,
        session: null,
      });

      const response = await handler(
        new Request('http://localhost/products/all'),
      );
      expect(response.status).toBe(401);
    });

    it('returns the unpaginated product list on success', async () => {
      const findAll = vi.fn(() => Effect.succeed([makeProductResponse()]));
      const { handler } = makeProductsRouterHarness({
        service: { findAll },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/all'),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ id: PRODUCT_ID });
      expect(findAll).toHaveBeenCalledTimes(1);
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          findAll: () =>
            Effect.fail(
              new ProductsInfrastructureError({
                action: 'findAll',
                messageKey: 'products.infrastructureError',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/all'),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /products — paginated
  // -------------------------------------------------------------------
  describe('GET /products (paginated)', () => {
    const paginated = {
      data: [makeProductResponse()],
      meta: { total: 1, page: 1, limit: 20, total_pages: 1 },
    };

    it('rejects without PRODUCTS:read permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findAllPaginated: () => Effect.succeed(paginated) },
        permissions: {},
      });

      const response = await handler(new Request('http://localhost/products'));
      expect(response.status).toBe(403);
    });

    it('returns 400 when the query is malformed', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findAllPaginated: () => Effect.succeed(paginated) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products?min_price=-1'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the paginated payload on success', async () => {
      const findAllPaginated = vi.fn(() => Effect.succeed(paginated));
      const { handler } = makeProductsRouterHarness({
        service: { findAllPaginated },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products?page=1&limit=20'),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        data: [{ id: PRODUCT_ID }],
        meta: { total: 1 },
      });
      expect(findAllPaginated).toHaveBeenCalledTimes(1);
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          findAllPaginated: () =>
            Effect.fail(
              new ProductsInfrastructureError({
                action: 'findAllPaginated',
                messageKey: 'products.infrastructureError',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(new Request('http://localhost/products'));
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // POST /products/bulk
  // -------------------------------------------------------------------
  describe('POST /products/bulk', () => {
    const validBody = { products: [validCreateBody] };

    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { bulkCreate: () => Effect.succeed(bulkResult()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkCreate: () => Effect.die('service should not be called'),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'POST',
          headers: jsonHeaders,
          // empty array violates minItems(1)
          body: JSON.stringify({ products: [] }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 201 and writes a CREATE audit on success', async () => {
      const bulkCreate = vi.fn(() => Effect.succeed(bulkResult()));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { bulkCreate },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual(bulkResult());
      expect(bulkCreate).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkCreate: () =>
            Effect.fail(
              new ProductsInfrastructureError({
                action: 'bulkCreate',
                messageKey: 'products.infrastructureError',
              }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // POST /products/import
  // -------------------------------------------------------------------
  describe('POST /products/import', () => {
    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: {
          importFromCsvContent: () => Effect.succeed(importResult()),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(403);
      expect(mockMultipart).not.toHaveBeenCalled();
    });

    it('rejects when SmartImport is disabled', async () => {
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: writeAll,
        smartImportFeatureEnabled: false,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        messageKey: 'features.notEnabled',
      });
      expect(mockMultipart).not.toHaveBeenCalled();
      expect(importFromCsvContent).not.toHaveBeenCalled();
    });

    it('rejects without LOCATIONS and INVENTORY write permissions', async () => {
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: productsWriteOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(403);
      expect(mockMultipart).not.toHaveBeenCalled();
      expect(importFromCsvContent).not.toHaveBeenCalled();
    });

    it('returns 400 when the multipart body is malformed', async () => {
      const { Schema, Effect } =
        await vi.importActual<typeof import('effect')>('effect');
      const multipartError = Schema.decodeUnknown(
        Schema.Struct({ file: Schema.String }),
      )({}).pipe(Effect.flip, Effect.runSync);
      mockMultipart.mockReturnValue(Effect.fail(multipartError));
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(400);
      expect(importFromCsvContent).not.toHaveBeenCalled();
    });

    it('returns 500 when reading the uploaded file fails', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
        }),
      );
      mockReadFile.mockRejectedValueOnce(new Error('disk read failed'));
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 500,
        messageKey: 'products.importReadUploadFailed',
      });
      expect(importFromCsvContent).not.toHaveBeenCalled();
    });

    it('calls the import service and returns ProductImportResultDto', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
        }),
      );
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(importResult());
      expect(mockReadFile).toHaveBeenCalledWith('/tmp/products-import.csv');
      expect(importFromCsvContent).toHaveBeenCalledWith({
        content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
        importType: 'auto',
        approvedPlan: undefined,
        userId: '00000000-0000-4000-a000-000000000001',
      });
    });

    it('parses the approved import plan and passes it to the service', async () => {
      const approvedPlan = {
        defaultLocationName: 'Main Warehouse',
        locationMappings: [
          {
            sourceLocation: 'Bay I - Shelf 3',
            targetLocationName: 'Main Warehouse',
            areaPath: 'Bay I / Shelf 3',
            action: 'create-area',
            confidence: 0.9,
            rowCount: 1,
          },
        ],
      };
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'sortly-items',
          plan: JSON.stringify(approvedPlan),
        }),
      );
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(200);
      expect(importFromCsvContent).toHaveBeenCalledWith({
        content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
        importType: 'sortly-items',
        approvedPlan,
        userId: '00000000-0000-4000-a000-000000000001',
      });
    });

    it('passes an AI proposal plan from the UI review flow to the import service', async () => {
      const aiProposalPlan = {
        format: 'sortly-items',
        confidence: 0.91,
        productIdentity: {
          sourceColumn: 'SID',
          conflictPolicy: 'derive-sku',
        },
        categoryMappings: [],
        supplierMappings: [],
        locationMappings: [],
        warnings: [],
      };
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'sortly-items',
          plan: JSON.stringify(aiProposalPlan),
        }),
      );
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(200);
      expect(importFromCsvContent).toHaveBeenCalledWith({
        content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
        importType: 'sortly-items',
        approvedPlan: aiProposalPlan,
        userId: '00000000-0000-4000-a000-000000000001',
      });
    });

    it('returns 400 when the approved import plan is malformed JSON', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
          plan: '{not-json',
        }),
      );
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        statusCode: 400,
        messageKey: 'products.importPlanParseFailed',
      });
      expect(importFromCsvContent).not.toHaveBeenCalled();
    });

    it('returns 400 when import plan mapping fields are malformed', async () => {
      const malformedPlans = [
        { locationMappings: 'oops' },
        {
          locationMappings: [
            {
              sourceLocation: 'Bay I - Shelf 3',
              action: 'create-area',
              targetLocationId: {},
            },
          ],
        },
        {
          locationMappings: [
            { sourceLocation: 'Bay I - Shelf 3', action: 'move' },
          ],
        },
        {
          locationMappings: [
            { sourceLocation: 'Bay I - Shelf 3', action: 'create-area' },
          ],
        },
        { categoryMappings: [{ sourcePath: 'Spa' }] },
        { supplierMappings: [{ supplierName: 'Supplier' }] },
      ];

      for (const malformedPlan of malformedPlans) {
        mockMultipart.mockReturnValue(
          Effect.succeed({
            file: makePersistedFile(),
            import_type: 'auto',
            plan: JSON.stringify(malformedPlan),
          }),
        );
        const importFromCsvContent = vi.fn(() =>
          Effect.succeed(importResult()),
        );
        const { handler } = makeProductsRouterHarness({
          service: {},
          importService: { importFromCsvContent },
          permissions: writeAll,
        });

        const response = await handler(
          new Request('http://localhost/products/import', {
            method: 'POST',
            body: 'ignored',
          }),
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          statusCode: 400,
          messageKey: 'products.importPlanParseFailed',
        });
        expect(importFromCsvContent).not.toHaveBeenCalled();
      }
    });
  });

  // -------------------------------------------------------------------
  // POST /products/import/preview
  // -------------------------------------------------------------------
  describe('POST /products/import/preview', () => {
    it('rejects when SmartImport is disabled', async () => {
      const previewCsvContent = vi.fn(() => Effect.succeed(importPreview()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { previewCsvContent },
        permissions: writeAll,
        smartImportFeatureEnabled: false,
      });

      const response = await handler(
        new Request('http://localhost/products/import/preview', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(403);
      expect(mockMultipart).not.toHaveBeenCalled();
      expect(previewCsvContent).not.toHaveBeenCalled();
    });

    it('calls the import service and returns ProductImportPreviewDto', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
        }),
      );
      const previewCsvContent = vi.fn(() => Effect.succeed(importPreview()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { previewCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import/preview', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(importPreview());
      expect(previewCsvContent).toHaveBeenCalledWith({
        content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
        importType: 'auto',
      });
    });
  });

  // -------------------------------------------------------------------
  // POST /products/import/propose
  // -------------------------------------------------------------------
  describe('POST /products/import/propose', () => {
    it('calls the import service and returns ProductImportAiProposalDto', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'sortly-items',
        }),
      );
      const proposeImportPlan = vi.fn(() => Effect.succeed(importProposal()));
      const { handler } = makeProductsRouterHarness({
        service: {},
        importService: { proposeImportPlan },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/import/propose', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(importProposal());
      expect(proposeImportPlan).toHaveBeenCalledWith({
        content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
        importType: 'sortly-items',
      });
    });
  });

  // -------------------------------------------------------------------
  // GET /products/category/:categoryId/tree
  // -------------------------------------------------------------------
  describe('GET /products/category/:categoryId/tree', () => {
    it('rejects without PRODUCTS:read permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findByCategoryTree: () => Effect.succeed([]) },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/products/category/${CATEGORY_ID}/tree`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when categoryId is not a UUID', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findByCategoryTree: () => Effect.succeed([]) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/category/not-a-uuid/tree'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the product list on success', async () => {
      const findByCategoryTree = vi.fn(() =>
        Effect.succeed([makeProductResponse()]),
      );
      const { handler } = makeProductsRouterHarness({
        service: { findByCategoryTree },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/category/${CATEGORY_ID}/tree`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toHaveLength(1);
      expect(findByCategoryTree).toHaveBeenCalledWith(CATEGORY_ID);
    });

    it('maps CategoryNotFound → 404', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          findByCategoryTree: () =>
            Effect.fail(
              new CategoryNotFound({
                categoryId: CATEGORY_ID,
                messageKey: 'products.categoryNotFound',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/category/${CATEGORY_ID}/tree`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // GET /products/category/:categoryId
  // -------------------------------------------------------------------
  describe('GET /products/category/:categoryId', () => {
    it('rejects without PRODUCTS:read permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findByCategory: () => Effect.succeed([]) },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/products/category/${CATEGORY_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when categoryId is not a UUID', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findByCategory: () => Effect.succeed([]) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/category/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the product list on success', async () => {
      const findByCategory = vi.fn(() =>
        Effect.succeed([makeProductResponse()]),
      );
      const { handler } = makeProductsRouterHarness({
        service: { findByCategory },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/category/${CATEGORY_ID}`),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toHaveLength(1);
      expect(findByCategory).toHaveBeenCalledWith(CATEGORY_ID);
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          findByCategory: () =>
            Effect.fail(
              new ProductsInfrastructureError({
                action: 'findByCategory',
                messageKey: 'products.infrastructureError',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/category/${CATEGORY_ID}`),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // POST /products — create
  // -------------------------------------------------------------------
  describe('POST /products', () => {
    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { create: () => Effect.succeed(makeProductResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validCreateBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          create: () => Effect.die('service should not be called'),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products', {
          method: 'POST',
          headers: jsonHeaders,
          // missing `name`, `sku`, etc.
          body: JSON.stringify({ reorder_point: 5 }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 201 and writes a CREATE audit on success', async () => {
      const created = makeProductResponse();
      const create = vi.fn(() => Effect.succeed(created));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { create },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/products', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validCreateBody),
        }),
      );

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toMatchObject({ id: PRODUCT_ID });
      expect(create).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps SkuAlreadyExists → 400 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: {
          create: () =>
            Effect.fail(
              new SkuAlreadyExists({
                sku: 'SKU-1',
                messageKey: 'products.skuAlreadyExists',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/products', {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify(validCreateBody),
        }),
      );
      expect(response.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // PATCH /products/bulk/status
  // -------------------------------------------------------------------
  describe('PATCH /products/bulk/status', () => {
    const validBody = { ids: [PRODUCT_ID, OTHER_PRODUCT_ID], is_active: false };

    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { bulkUpdateStatus: () => Effect.succeed(bulkResult()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/status', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkUpdateStatus: () => Effect.die('service should not be called'),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/status', {
          method: 'PATCH',
          headers: jsonHeaders,
          // is_active missing
          body: JSON.stringify({ ids: [PRODUCT_ID] }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes a STATUS_CHANGE audit on success', async () => {
      const bulkUpdateStatus = vi.fn(() => Effect.succeed(bulkResult()));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { bulkUpdateStatus },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/status', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(bulkResult());
      expect(bulkUpdateStatus).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.STATUS_CHANGE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkUpdateStatus: () =>
            Effect.fail(
              new ProductsInfrastructureError({
                action: 'bulkUpdateStatus',
                messageKey: 'products.infrastructureError',
              }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/status', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // PATCH /products/bulk/restore
  // -------------------------------------------------------------------
  describe('PATCH /products/bulk/restore', () => {
    const validBody = { ids: [PRODUCT_ID] };

    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { bulkRestore: () => Effect.succeed(bulkResult()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/restore', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkRestore: () => Effect.die('service should not be called'),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/restore', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify({ ids: [] }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes a RESTORE audit on success', async () => {
      const bulkRestore = vi.fn(() => Effect.succeed(bulkResult()));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { bulkRestore },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/restore', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(bulkResult());
      expect(bulkRestore).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.RESTORE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps ProductNotDeleted → 400', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkRestore: () =>
            Effect.fail(
              new ProductNotDeleted({
                productId: PRODUCT_ID,
                messageKey: 'products.notDeleted',
              }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk/restore', {
          method: 'PATCH',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  // DELETE /products/bulk
  // -------------------------------------------------------------------
  describe('DELETE /products/bulk', () => {
    const validBody = { ids: [PRODUCT_ID] };

    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { bulkDelete: () => Effect.succeed(bulkResult()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'DELETE',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 on malformed body', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkDelete: () => Effect.die('service should not be called'),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'DELETE',
          headers: jsonHeaders,
          body: JSON.stringify({ ids: [] }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes a DELETE audit on success', async () => {
      const bulkDelete = vi.fn(() => Effect.succeed(bulkResult()));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { bulkDelete },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'DELETE',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(bulkResult());
      expect(bulkDelete).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps infrastructure failure → 500', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          bulkDelete: () =>
            Effect.fail(
              new ProductsInfrastructureError({
                action: 'bulkDelete',
                messageKey: 'products.infrastructureError',
              }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/bulk', {
          method: 'DELETE',
          headers: jsonHeaders,
          body: JSON.stringify(validBody),
        }),
      );
      expect(response.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------
  // GET /products/:id
  // -------------------------------------------------------------------
  describe('GET /products/:id', () => {
    it('rejects without PRODUCTS:read permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findOne: () => Effect.succeed(makeProductResponse()) },
        permissions: {},
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { findOne: () => Effect.succeed(makeProductResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/products/not-a-uuid'),
      );
      expect(response.status).toBe(400);
    });

    it('returns the product on success', async () => {
      const findOne = vi.fn((id: string) =>
        Effect.succeed(makeProductResponse({ id })),
      );
      const { handler } = makeProductsRouterHarness({
        service: { findOne },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ id: PRODUCT_ID });
      expect(findOne).toHaveBeenCalledWith(PRODUCT_ID, false);
    });

    it('maps ProductNotFound → 404', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          findOne: (id: string) =>
            Effect.fail(
              new ProductNotFound({
                productId: id,
                messageKey: 'products.notFound',
              }),
            ),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`),
      );
      expect(response.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------
  // PUT /products/:id
  // -------------------------------------------------------------------
  describe('PUT /products/:id', () => {
    const updateBody = { name: 'Renamed' };

    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { update: () => Effect.succeed(makeProductResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when the body fails schema decode', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { update: () => Effect.succeed(makeProductResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          // name becomes empty after Trim
          body: JSON.stringify({ name: '' }),
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes an UPDATE audit on success', async () => {
      const updated = makeProductResponse({ name: 'Renamed' });
      const update = vi.fn(() => Effect.succeed(updated));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { update },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ name: 'Renamed' });
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps PriceBelowCost → 400 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: {
          update: () =>
            Effect.fail(
              new PriceBelowCost({
                standardPrice: 1,
                standardCost: 5,
                messageKey: 'products.priceBelowCost',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`, {
          method: 'PUT',
          headers: jsonHeaders,
          body: JSON.stringify(updateBody),
        }),
      );
      expect(response.status).toBe(400);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------
  // PATCH /products/:id/restore
  // -------------------------------------------------------------------
  describe('PATCH /products/:id/restore', () => {
    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { restore: () => Effect.succeed(makeProductResponse()) },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/restore`, {
          method: 'PATCH',
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { restore: () => Effect.succeed(makeProductResponse()) },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/not-a-uuid/restore', {
          method: 'PATCH',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes a RESTORE audit on success', async () => {
      const restore = vi.fn(() => Effect.succeed(makeProductResponse()));
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { restore },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/restore`, {
          method: 'PATCH',
        }),
      );

      expect(response.status).toBe(200);
      expect(restore).toHaveBeenCalledWith(PRODUCT_ID);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.RESTORE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps ProductNotDeleted → 400', async () => {
      const { handler } = makeProductsRouterHarness({
        service: {
          restore: () =>
            Effect.fail(
              new ProductNotDeleted({
                productId: PRODUCT_ID,
                messageKey: 'products.notDeleted',
              }),
            ),
        },
        permissions: writeAll,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}/restore`, {
          method: 'PATCH',
        }),
      );
      expect(response.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------
  // DELETE /products/:id
  // -------------------------------------------------------------------
  describe('DELETE /products/:id', () => {
    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { delete: () => Effect.void },
        permissions: readOnly,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(403);
    });

    it('returns 400 when id is not a UUID', async () => {
      const { handler } = makeProductsRouterHarness({
        service: { delete: () => Effect.void },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/products/not-a-uuid', {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(400);
    });

    it('returns 200 and writes a DELETE audit on success', async () => {
      const del = vi.fn(() => Effect.void);
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: { delete: del },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`, {
          method: 'DELETE',
        }),
      );

      expect(response.status).toBe(200);
      const body = (await response.json()) as any;
      expect(body).toHaveProperty('message');
      expect(del).toHaveBeenCalledWith(PRODUCT_ID, expect.any(String), false);
      expect(auditLog).toHaveBeenCalledWith({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.PRODUCT,
        entityId: PRODUCT_ID,
      });
    });

    it('maps ProductNotFound → 404 and skips audit', async () => {
      const auditLog = vi.fn(() => Effect.void);
      const { handler } = makeProductsRouterHarness({
        service: {
          delete: (id: string) =>
            Effect.fail(
              new ProductNotFound({
                productId: id,
                messageKey: 'products.notFound',
              }),
            ),
        },
        permissions: writeAll,
        auditLog,
      });

      const response = await handler(
        new Request(`http://localhost/products/${PRODUCT_ID}`, {
          method: 'DELETE',
        }),
      );
      expect(response.status).toBe(404);
      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  it('exposes the ProductsService tag', () => {
    expect(ProductsService).toBeDefined();
  });
});
