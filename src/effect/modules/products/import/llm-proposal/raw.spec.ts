import { Effect } from 'effect';
import { decodeOpenAiProposalResponse, decodeRawLlmProposal } from './raw';

const validRawProposal = {
  format: 'normalized-products',
  confidence: 0.75,
  productIdentity: {
    sourceColumn: 'sku',
    conflictPolicy: 'derive-sku',
  },
  skuConflictResolutions: [
    {
      conflictKey: 'sku-conflict:SKU-1',
      confidence: 0.8,
      reason: null,
      reviewRequired: true,
      variants: [
        {
          variantKey: 'sku-conflict:SKU-1:variant:first',
          action: 'derive-sku',
          targetSku: 'SKU-1-1',
        },
      ],
    },
  ],
  missingLocationStrategy: {
    action: 'assign-review-area',
    targetLocationId: null,
    targetLocationName: 'Imported Inventory',
    targetAreaId: null,
    areaPath: 'Unassigned / Needs Review',
    confidence: 0.6,
    reason: 'No source location was supplied.',
    reviewRequired: true,
  },
  categoryMappings: [
    {
      sourcePath: 'Dental',
      targetCategoryId: null,
      targetPath: 'Consumables / Dental',
      action: 'create',
      confidence: 0.7,
      reason: null,
      reviewRequired: true,
    },
  ],
  supplierMappings: [],
  locationMappings: [
    {
      sourceLocation: 'Shelf 1',
      targetLocationId: null,
      targetLocationName: 'Warehouse',
      targetAreaId: null,
      areaPath: 'Shelf 1',
      childAreas: [
        { name: 'Bin 1' },
        { name: 'Bin 2' },
        { name: 'Bin 3' },
        { name: 'Bin 4' },
      ],
      action: 'create-area',
      confidence: 0.8,
      reason: null,
      reviewRequired: true,
    },
  ],
  warnings: [
    {
      row: 2,
      field: 'sku',
      severity: 'warning',
      message: 'Duplicate SKU',
    },
  ],
} as const;

describe('OpenAI proposal decoding', () => {
  it('decodes a complete strict proposal object', async () => {
    await expect(
      Effect.runPromise(decodeRawLlmProposal(validRawProposal)),
    ).resolves.toEqual(validRawProposal);
  });

  it('decodes direct and nested Responses API JSON text once', async () => {
    const text = JSON.stringify(validRawProposal);
    await expect(
      Effect.runPromise(decodeOpenAiProposalResponse({ output_text: text })),
    ).resolves.toEqual(validRawProposal);
    await expect(
      Effect.runPromise(
        decodeOpenAiProposalResponse({
          output: [
            { type: 'reasoning' },
            { content: [{ type: 'output_text', text }] },
          ],
        }),
      ),
    ).resolves.toEqual(validRawProposal);
  });

  it('rejects malformed envelopes and nested proposal JSON', async () => {
    await expect(
      Effect.runPromise(decodeOpenAiProposalResponse({ output: [] })),
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(
        decodeOpenAiProposalResponse({ output_text: '{not-json' }),
      ),
    ).rejects.toBeDefined();
    await expect(
      Effect.runPromise(
        decodeOpenAiProposalResponse({
          output_text: JSON.stringify({
            ...validRawProposal,
            format: 'hallucinated',
          }),
        }),
      ),
    ).rejects.toBeDefined();
  });
});
