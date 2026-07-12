import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocationType } from '@stocket/types/locations';
import type {
  ProductImportPreviewDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import { ProductImportLlmProposer } from './llm-proposer';

const preview: ProductImportPreviewDto = {
  format: 'sortly-items',
  totalRows: 3,
  itemRows: 2,
  folderRows: 1,
  photoUrlCount: 1,
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

const context: ProductImportTargetContextDto = {
  categories: [],
  locations: [
    { id: 'loc-1', name: 'Warehouse A', type: LocationType.WAREHOUSE },
  ],
  areas: [],
};

const runProposer = () =>
  Effect.runPromise(
    Effect.flatMap(ProductImportLlmProposer, (service) =>
      service.propose(preview, context),
    ).pipe(Effect.provide(ProductImportLlmProposer.Default)),
  );

const validRawProposal = () => ({
  format: 'sortly-items',
  confidence: 0.91,
  productIdentity: {
    sourceColumn: 'SID',
    conflictPolicy: 'derive-sku',
  },
  skuConflictResolutions: [],
  missingLocationStrategy: {
    action: 'skip-inventory',
    targetLocationId: null,
    targetLocationName: null,
    targetAreaId: null,
    areaPath: null,
    confidence: 1,
    reason: null,
    reviewRequired: false,
  },
  categoryMappings: [
    {
      sourcePath: 'Accessories / Dental',
      targetCategoryId: null,
      targetPath: 'Guest Accessories / Dental',
      action: 'create',
      confidence: 0.94,
      reason: 'A cleaner taxonomy.',
      reviewRequired: false,
    },
    {
      sourcePath: 'Hallucinated Source',
      targetCategoryId: null,
      targetPath: 'Ignored',
      action: 'create',
      confidence: 1,
      reason: null,
      reviewRequired: false,
    },
  ],
  supplierMappings: [],
  locationMappings: [
    {
      sourceLocation: 'Bay I - Shelf 3',
      targetLocationId: 'loc-1',
      targetLocationName: null,
      targetAreaId: null,
      areaPath: 'Bay I / Shelf 3',
      childAreas: [],
      action: 'create-area',
      confidence: 0.95,
      reason: 'Bay and shelf form an area hierarchy.',
      reviewRequired: false,
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
});

describe('ProductImportLlmProposer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('falls back to a complete deterministic v2 proposal without an API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const proposal = await runProposer();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(proposal).toMatchObject({
      planVersion: 2,
      proposalSource: 'deterministic',
      supplierMappings: [],
    });
    expect(proposal.categoryMappings).toHaveLength(1);
    expect(proposal.locationMappings).toHaveLength(1);
    expect(proposal.skuConflictResolutions).toHaveLength(1);
  });

  it('calls the Responses API and sanitizes source coverage and tenant IDs', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('PRODUCT_IMPORT_LLM_MODEL', 'test-model');
    vi.stubEnv('OPENAI_BASE_URL', 'https://api.openai.test/v1');
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ output_text: JSON.stringify(validRawProposal()) }),
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const proposal = await runProposer();

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.test/v1/responses',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(proposal.proposalSource).toBe('ai');
    expect(proposal.categoryMappings).toEqual([
      expect.objectContaining({
        sourcePath: 'Accessories / Dental',
        targetPath: 'Guest Accessories / Dental',
        action: 'create',
        rowCount: 2,
      }),
    ]);
    expect(proposal.locationMappings).toEqual([
      expect.objectContaining({
        sourceLocation: 'Bay I - Shelf 3',
        targetLocationId: 'loc-1',
        areaPath: 'Bay I / Shelf 3',
        action: 'create-area',
        rowCount: 2,
      }),
    ]);
    expect(proposal.supplierMappings).toEqual([]);
  });

  it('falls back deterministically when strict structured output is malformed', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ output_text: '{"format":"invalid"}' }),
      })),
    );

    const proposal = await runProposer();

    expect(proposal.proposalSource).toBe('deterministic');
    expect(proposal.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('AI proposal unavailable'),
        }),
      ]),
    );
  });
});
