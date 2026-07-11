import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
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

const queuedTask = () => ({
  id: '10000000-0000-4000-8000-000000000001',
  type: 'product-import',
  status: 'queued',
  result: null,
  error: null,
  attempt_count: 0,
  max_attempts: 3,
  run_after: new Date('2026-07-10T10:00:00.000Z'),
  progress: {
    total: null,
    processed: 0,
    failed: 0,
    percent: null,
    message: 'Product import is queued.',
    message_key: 'products.importProgressQueued',
    message_args: null,
  },
  cancel_requested_at: null,
  started_at: null,
  completed_at: null,
  created_at: new Date('2026-07-10T10:00:00.000Z'),
  updated_at: new Date('2026-07-10T10:00:00.000Z'),
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
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
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
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('rejects without LOCATIONS and INVENTORY write permissions', async () => {
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
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
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('returns 400 when the multipart body is malformed', async () => {
      const { Schema, Effect } =
        await vi.importActual<typeof import('effect')>('effect');
      const multipartError = Schema.decodeUnknown(
        Schema.Struct({ file: Schema.String }),
      )({}).pipe(Effect.flip, Effect.runSync);
      mockMultipart.mockReturnValue(Effect.fail(multipartError));
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(400);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('returns 400 for an empty idempotency key', async () => {
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          headers: { 'idempotency-key': '   ' },
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(400);
      expect(mockMultipart).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('returns 500 when reading the uploaded file fails', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
        }),
      );
      mockReadFile.mockRejectedValueOnce(new Error('disk read failed'));
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
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
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('stores the upload asynchronously and returns the queued task', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
        }),
      );
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          headers: { 'idempotency-key': ' product-import-request-1 ' },
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(202);
      expect(response.headers.get('location')).toBe(
        '/api/v1/tasks/10000000-0000-4000-8000-000000000001',
      );
      await expect(response.json()).resolves.toMatchObject({
        id: '10000000-0000-4000-8000-000000000001',
        type: 'product-import',
        status: 'queued',
      });
      expect(mockReadFile).toHaveBeenCalledWith('/tmp/products-import.csv');
      expect(enqueue).toHaveBeenCalledWith({
        bytes: Buffer.from('sku,name,category_path\nSKU-1,Whisky,Spirits\n'),
        importType: 'auto',
        approvedPlan: undefined,
        idempotencyKey: 'product-import-request-1',
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
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(202);
      expect(enqueue).toHaveBeenCalledWith({
        bytes: Buffer.from('sku,name,category_path\nSKU-1,Whisky,Spirits\n'),
        importType: 'sortly-items',
        approvedPlan,
        userId: '00000000-0000-4000-a000-000000000001',
      });
    });

    it('accepts a complete version 2 execution plan', async () => {
      const approvedPlan = {
        planVersion: 2,
        skuConflictPolicy: 'reject',
        skuConflictResolutions: [],
        missingLocationStrategy: {
          mappingKey: 'missing-location',
          confidence: 1,
          reviewRequired: false,
          rowCount: 0,
          action: 'skip-inventory',
        },
        categoryMappings: [],
        locationMappings: [],
      };
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'normalized-products',
          plan: JSON.stringify(approvedPlan),
        }),
      );
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(202);
      expect(enqueue).toHaveBeenCalledWith({
        bytes: Buffer.from('sku,name,category_path\nSKU-1,Whisky,Spirits\n'),
        importType: 'normalized-products',
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
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
        permissions: writeAll,
      });

      const response = await handler(
        new Request('http://localhost/import', {
          method: 'POST',
          body: 'ignored',
        }),
      );

      expect(response.status).toBe(202);
      expect(enqueue).toHaveBeenCalledWith({
        bytes: Buffer.from('sku,name,category_path\nSKU-1,Whisky,Spirits\n'),
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
      const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
      const { handler } = makeProductImportRouterHarness({
        backgroundService: { enqueue },
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
      expect(enqueue).not.toHaveBeenCalled();
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
        const enqueue = vi.fn(() => Effect.succeed(queuedTask()));
        const { handler } = makeProductImportRouterHarness({
          backgroundService: { enqueue },
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
        expect(enqueue).not.toHaveBeenCalled();
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

    it('ignores proposal guidance and remains preview-only', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
          guidance: '{not-json',
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
        guidance: undefined,
      });
    });

    it('decodes optional guidance and passes it only to proposal analysis', async () => {
      mockMultipart.mockReturnValue(
        Effect.succeed({
          file: makePersistedFile(),
          import_type: 'auto',
          guidance: JSON.stringify({
            instructions: 'Keep the existing category names.',
          }),
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
      expect(proposeImportPlan).toHaveBeenCalledWith({
        content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
        importType: 'auto',
        guidance: {
          instructions: 'Keep the existing category names.',
        },
      });
    });

    it('returns a typed 400 for malformed or oversized guidance', async () => {
      const malformedGuidance = [
        '{not-json',
        JSON.stringify({ instructions: 'x'.repeat(4_001) }),
        JSON.stringify({
          locks: {
            categoryMappings: Array.from(
              { length: 501 },
              (_, index) => `category:${index}`,
            ),
          },
        }),
      ];

      for (const guidance of malformedGuidance) {
        mockMultipart.mockReturnValue(
          Effect.succeed({
            file: makePersistedFile(),
            import_type: 'auto',
            guidance,
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

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toMatchObject({
          messageKey: 'products.importGuidanceParseFailed',
          statusCode: 400,
        });
        expect(proposeImportPlan).not.toHaveBeenCalled();
      }
    });
  });
});
