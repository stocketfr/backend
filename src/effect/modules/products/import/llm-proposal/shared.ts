import type { ProductImportAiProposalV2Dto } from '@stocket/types/products';

export const PRODUCT_IMPORT_CATEGORY_EVIDENCE_MAX_EXAMPLES = 8;

export const messageFromUnknown = (
  value: unknown,
  fallback: string,
): string => {
  if (value instanceof Error && value.message.trim() !== '') {
    return value.message;
  }

  return fallback;
};

export const appendWarning = (
  proposal: ProductImportAiProposalV2Dto,
  message: string,
): ProductImportAiProposalV2Dto => ({
  ...proposal,
  warnings: [
    ...proposal.warnings,
    {
      severity: 'warning',
      message,
    },
  ],
});
