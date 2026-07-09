import type { ProductImportAiProposalDto } from '@stocket/types/products';

export const isUnknownRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const messageFromUnknown = (
  value: unknown,
  fallback: string,
): string => {
  if (value instanceof Error && value.message.trim() !== '') {
    return value.message;
  }

  if (
    isUnknownRecord(value) &&
    typeof value.message === 'string' &&
    value.message.trim() !== ''
  ) {
    return value.message;
  }

  return fallback;
};

export const appendWarning = (
  proposal: ProductImportAiProposalDto,
  message: string,
): ProductImportAiProposalDto => ({
  ...proposal,
  warnings: [
    ...proposal.warnings,
    {
      severity: 'warning',
      message,
    },
  ],
});
