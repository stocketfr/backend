import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { PRODUCT_IMPORT_PROGRESS_MESSAGES } from './types';
import { makeProductImportRouterHarness } from './__fixtures__/router-harness';

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

const TASK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const taskResponse = () => ({
  id: TASK_ID,
  tenant_id: '55555555-5555-4555-8555-555555555555',
  type: 'product-import',
  status: 'queued',
  result: null,
  error: null,
  created_by: '00000000-0000-4000-a000-000000000001',
  attempt_count: 0,
  max_attempts: 3,
  run_after: new Date('2026-01-01T00:00:00.000Z'),
  progress: {
    total: null,
    processed: 0,
    failed: 0,
    percent: null,
    message: PRODUCT_IMPORT_PROGRESS_MESSAGES.queued,
    messageKey: PRODUCT_IMPORT_PROGRESS_MESSAGES.queued,
  },
  cancel_requested_at: null,
  started_at: null,
  completed_at: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
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

describe('productImportRouter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue(
      Buffer.from('sku,name,category_path\nSKU-1,Whisky,Spirits\n'),
    );
  });

  describe('POST /import', () => {
    it('rejects without PRODUCTS:write permission', async () => {
      const { handler } = makeProductImportRouterHarness({
        importService: {
          importFromCsvContent: () => Effect.succeed(importResult()),
        },
        permissions: readOnly,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(403);
      expect(mockMultipart).not.toHaveBeenCalled();
    });

    it('rejects when SmartImport is disabled', async () => {
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        permissions: writeAll,
        smartImportFeatureEnabled: false,
      });

      const response = await handler(
        new Request('http://localhost/import', {
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
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        permissions: productsWriteOnly,
      });

      const response = await handler(
        new Request('http://localhost/import', {
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
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
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
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
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

    it('enqueues a product import task and returns 202 with Location', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
        }),
      );
      const importFromCsvContent = vi.fn(() => Effect.succeed(importResult()));
      const enqueue = vi.fn(() => Effect.succeed(taskResponse()));
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        tasksService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(202);
      expect(response.headers.get('location')).toBe(`/api/v1/tasks/${TASK_ID}`);
      await expect(response.json()).resolves.toMatchObject({
        id: TASK_ID,
        type: 'product-import',
        status: 'queued',
        progress: {
          message: 'Queued product import.',
          messageKey: PRODUCT_IMPORT_PROGRESS_MESSAGES.queued,
        },
      });
      expect(mockReadFile).toHaveBeenCalledWith('/tmp/products-import.csv');
      expect(importFromCsvContent).not.toHaveBeenCalled();
      expect(enqueue).toHaveBeenCalledWith({
        type: 'product-import',
        payload: {
          content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
          importType: 'auto',
          userId: '00000000-0000-4000-a000-000000000001',
        },
        createdBy: '00000000-0000-4000-a000-000000000001',
        maxAttempts: 3,
        progressMessage: PRODUCT_IMPORT_PROGRESS_MESSAGES.queued,
      });
    });

    it('parses the approved import plan and stores it in the queued task payload', async () => {
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
      const enqueue = vi.fn(() => Effect.succeed(taskResponse()));
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        tasksService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(202);
      expect(importFromCsvContent).not.toHaveBeenCalled();
      expect(enqueue).toHaveBeenCalledWith({
        type: 'product-import',
        payload: {
          content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
          importType: 'sortly-items',
          approvedPlan,
          userId: '00000000-0000-4000-a000-000000000001',
        },
        createdBy: '00000000-0000-4000-a000-000000000001',
        maxAttempts: 3,
        progressMessage: PRODUCT_IMPORT_PROGRESS_MESSAGES.queued,
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
      const enqueue = vi.fn(() => Effect.succeed(taskResponse()));
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        tasksService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(202);
      expect(importFromCsvContent).not.toHaveBeenCalled();
      expect(enqueue).toHaveBeenCalledWith({
        type: 'product-import',
        payload: {
          content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
          importType: 'sortly-items',
          approvedPlan: aiProposalPlan,
          userId: '00000000-0000-4000-a000-000000000001',
        },
        createdBy: '00000000-0000-4000-a000-000000000001',
        maxAttempts: 3,
        progressMessage: PRODUCT_IMPORT_PROGRESS_MESSAGES.queued,
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
      const { handler } = makeProductImportRouterHarness({
        importService: { importFromCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
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
        const { handler } = makeProductImportRouterHarness({
          importService: { importFromCsvContent },
          permissions: writeAll,
        });

        const response = await handler(
          new Request('http://localhost/import', {
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

  describe('POST /import/preview', () => {
    it('rejects when SmartImport is disabled', async () => {
      const previewCsvContent = vi.fn(() => Effect.succeed(importPreview()));
      const { handler } = makeProductImportRouterHarness({
        importService: { previewCsvContent },
        permissions: writeAll,
        smartImportFeatureEnabled: false,
      });

      const response = await handler(
        new Request('http://localhost/import/preview', {
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
      const { handler } = makeProductImportRouterHarness({
        importService: { previewCsvContent },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import/preview', {
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

  describe('POST /import/propose', () => {
    it('calls the import service and returns ProductImportAiProposalDto', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'sortly-items',
        }),
      );
      const proposeImportPlan = vi.fn(() => Effect.succeed(importProposal()));
      const { handler } = makeProductImportRouterHarness({
        importService: { proposeImportPlan },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import/propose', {
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
});
