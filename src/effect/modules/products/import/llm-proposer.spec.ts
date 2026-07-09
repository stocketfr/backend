import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductImportPreviewDto } from '@stocket/types/products';
import { ProductImportLlmProposer } from './llm-proposer';

const preview: ProductImportPreviewDto = {
  format: 'sortly-items',
  totalRows: 3,
  itemRows: 2,
  folderRows: 1,
  importableRows: 1,
  missingRequiredRows: 0,
  duplicateSkuConflicts: [
    {
      sku: 'SORT-1',
      rows: [2, 3],
      names: ['Gloves Black', 'Gloves White'],
    },
  ],
  categoryMappings: [
    {
      sourcePath: 'Accessories / Dental',
      targetPath: 'Accessories / Dental',
      action: 'create',
      rowCount: 2,
    },
  ],
  supplierMappings: [],
  locationMappings: [
    {
      sourceLocation: 'Bay I - Shelf 3',
      areaPath: 'Bay I / Shelf 3',
      action: 'create-area',
      confidence: 0.9,
      rowCount: 2,
    },
  ],
  inventoryPreviews: [],
  warnings: [
    {
      severity: 'error',
      field: 'sku',
      message: 'Duplicate SKU conflict',
    },
  ],
};

const runProposer = () =>
  Effect.runPromise(
    Effect.flatMap(ProductImportLlmProposer, (service) =>
      service.propose(preview),
    ).pipe(Effect.provide(ProductImportLlmProposer.Default)),
  );

describe('ProductImportLlmProposer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('falls back to the deterministic proposal when OPENAI_API_KEY is absent', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const proposal = await runProposer();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(proposal.productIdentity.conflictPolicy).toBe('derive-sku');
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            'AI proposal unavailable because OPENAI_API_KEY is not configured.',
        }),
      ]),
    );
  });

  it('calls the Responses API and sanitizes the structured proposal', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('PRODUCT_IMPORT_LLM_MODEL', 'test-model');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.test/v1');
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          format: 'sortly-items',
          confidence: 0.91,
          productIdentity: {
            sourceColumn: 'SID',
            conflictPolicy: 'derive-sku',
          },
          categoryMappings: [
            {
              sourcePath: 'Accessories / Dental',
              targetPath: 'Guest Accessories / Dental',
              action: 'create',
              rowCount: 999,
            },
            {
              sourcePath: 'Hallucinated Source',
              targetPath: 'Ignored',
              action: 'create',
              rowCount: 1,
            },
          ],
          supplierMappings: [
            {
              sourcePattern: 'Dental',
              supplierName: 'Dental Supplier',
              action: 'create',
              confidence: 0.88,
              rowCount: 2,
            },
          ],
          locationMappings: [
            {
              sourceLocation: 'Bay I - Shelf 3',
              targetLocationName: 'Warehouse A',
              areaPath: 'Bay I / Shelf 3',
              action: 'create-area',
              confidence: 0.95,
              rowCount: 999,
            },
          ],
          warnings: [
            {
              row: null,
              field: 'category_path',
              severity: 'warning',
              message: 'Review proposed taxonomy.',
            },
          ],
        }),
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const proposal = await runProposer();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.test/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
    const [, requestInit] = fetchSpy.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    const body = JSON.parse(requestInit.body);
    expect(body).toMatchObject({
      model: 'test-model',
      text: {
        format: {
          type: 'json_schema',
          name: 'product_import_ai_proposal',
          strict: true,
        },
      },
    });
    expect(proposal.categoryMappings).toEqual([
      {
        sourcePath: 'Accessories / Dental',
        targetPath: 'Guest Accessories / Dental',
        action: 'create',
        rowCount: 2,
      },
    ]);
    expect(proposal.locationMappings).toEqual([
      {
        sourceLocation: 'Bay I - Shelf 3',
        targetLocationName: 'Warehouse A',
        areaPath: 'Bay I / Shelf 3',
        action: 'create-area',
        confidence: 0.95,
        rowCount: 2,
      },
    ]);
    expect(proposal.supplierMappings).toEqual([
      {
        sourcePattern: 'Dental',
        supplierName: 'Dental Supplier',
        action: 'create',
        confidence: 0.88,
        rowCount: 2,
      },
    ]);
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', field: 'sku' }),
        expect.objectContaining({ message: 'Review proposed taxonomy.' }),
      ]),
    );
  });

  it('repairs malformed structured proposal fields without trusting the model', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          format: 'hallucinated-format',
          confidence: -3,
          productIdentity: {
            sourceColumn: '  ',
            conflictPolicy: 'overwrite',
          },
          categoryMappings: [
            {
              sourcePath: 'Accessories / Dental',
              targetPath: '  ',
              action: 'rename',
              rowCount: 999,
            },
            {
              sourcePath: 'Hallucinated Source',
              targetPath: 'Ignored',
              action: 'create',
              rowCount: 1,
            },
          ],
          supplierMappings: [
            {
              sourcePattern: '  ',
              supplierName: 'Ignored Supplier',
              action: 'create',
              confidence: 0.7,
              rowCount: 1,
            },
            {
              sourcePattern: 'Dental',
              supplierName: 'Dental Supplier',
              action: 'rename',
              confidence: 2,
              rowCount: -4,
            },
          ],
          locationMappings: [
            {
              sourceLocation: 'Bay I - Shelf 3',
              targetLocationName: '  ',
              areaPath: '  ',
              action: 'teleport',
              confidence: 3,
              rowCount: 999,
            },
          ],
          warnings: [
            {
              row: 1.5,
              field: ' category_path ',
              severity: 'panic',
              message: '  Needs review. ',
            },
            {
              severity: 'warning',
              message: '   ',
            },
          ],
        }),
      }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const proposal = await runProposer();

    expect(proposal).toMatchObject({
      format: 'sortly-items',
      confidence: 0,
      productIdentity: {
        sourceColumn: 'SID',
        conflictPolicy: 'derive-sku',
      },
      categoryMappings: [
        {
          sourcePath: 'Accessories / Dental',
          targetPath: 'Accessories / Dental',
          action: 'create',
          rowCount: 2,
        },
      ],
      supplierMappings: [
        {
          sourcePattern: 'Dental',
          supplierName: 'Dental Supplier',
          action: 'ignore',
          confidence: 1,
          rowCount: 0,
        },
      ],
      locationMappings: [
        {
          sourceLocation: 'Bay I - Shelf 3',
          action: 'create-area',
          confidence: 1,
          rowCount: 2,
        },
      ],
    });
    expect(proposal.locationMappings[0]).not.toHaveProperty(
      'targetLocationName',
    );
    expect(proposal.locationMappings[0]).not.toHaveProperty('areaPath');
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', field: 'sku' }),
        expect.objectContaining({
          severity: 'warning',
          field: 'category_path',
          message: 'Needs review.',
        }),
      ]),
    );
  });
});
