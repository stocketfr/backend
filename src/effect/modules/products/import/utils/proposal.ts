import type {
  ProductImportAiProposalDto,
  ProductImportPreviewDto,
} from '../types';
import { normalizeCategoryPath } from './csv';
import { makeImportWarning } from './warnings';

const inferTargetCategoryPath = (sourcePath: string): string => {
  const normalized = normalizeCategoryPath(sourcePath);
  const lower = normalized.toLowerCase();

  if (normalized === 'Uncategorized') return 'Needs Review / Uncategorized';
  if (/\b(dental|toothbrush|toothpaste|mouthwash)\b/.test(lower)) {
    return 'Guest Accessories / Dental';
  }
  if (/\b(sunscreen|spf|sun stick|sun cream)\b/.test(lower)) {
    return 'Guest Accessories / Sunscreen';
  }
  if (/\b(nails?|manicure|pedicure)\b/.test(lower)) {
    return 'Spa Supplies / Nails';
  }
  if (/\b(wax|waxing)\b/.test(lower)) return 'Spa Supplies / Waxing';
  if (/\b(massage)\b/.test(lower)) return 'Spa Supplies / Massage';
  if (/\b(towels?|linens?)\b/.test(lower)) {
    return 'Spa Supplies / Towels & Linens';
  }
  if (/\b(shampoo)\b/.test(lower)) return 'Guest Amenities / Shampoo';
  if (/\b(conditioner)\b/.test(lower)) return 'Guest Amenities / Conditioner';
  if (/\b(body wash|shower gel)\b/.test(lower)) {
    return 'Guest Amenities / Body Wash';
  }
  if (/\b(hand wash|hand soap)\b/.test(lower)) {
    return 'Guest Amenities / Hand Wash';
  }
  if (/\b(body lotion|hand lotion|body balm)\b/.test(lower)) {
    return 'Guest Amenities / Lotions & Balms';
  }
  if (/\b(soap)\b/.test(lower)) return 'Guest Amenities / Soap';
  if (/\b(minis?)\b/.test(lower)) return 'Guest Amenities / Minis';
  if (/\b(bags?)\b/.test(lower)) return 'Guest Accessories / Bags';
  if (/\b(baskets?)\b/.test(lower)) return 'Housekeeping / Baskets';
  if (/\b(trays?)\b/.test(lower)) return 'Housekeeping / Trays';
  if (/\b(pillows?)\b/.test(lower)) return 'Housekeeping / Pillows';
  if (/\b(equipment)\b/.test(lower)) return 'Spa Supplies / Equipment';

  return normalized;
};

export function makeProductImportProposal(
  preview: ProductImportPreviewDto,
): ProductImportAiProposalDto {
  const categoryMappings = preview.categoryMappings.map((mapping) => {
    const targetPath = inferTargetCategoryPath(mapping.sourcePath);
    const action: 'default' | 'create' =
      targetPath === 'Needs Review / Uncategorized' ? 'default' : 'create';
    return {
      ...mapping,
      targetPath,
      action,
    };
  });
  const locationMappings = preview.locationMappings.map((mapping) => ({
    ...mapping,
    confidence:
      mapping.action === 'create-area'
        ? Math.max(mapping.confidence, 0.9)
        : mapping.confidence,
  }));
  const warnings = [
    ...preview.warnings,
    makeImportWarning(
      'This proposal is generated from structured CSV analysis and must be reviewed before import.',
    ),
  ];

  return {
    format: preview.format,
    confidence: preview.warnings.some((warning) => warning.severity === 'error')
      ? 0.72
      : 0.84,
    productIdentity: {
      sourceColumn: preview.format === 'sortly-items' ? 'SID' : 'sku',
      conflictPolicy:
        preview.duplicateSkuConflicts.length > 0 ? 'derive-sku' : 'reject',
    },
    categoryMappings,
    supplierMappings: preview.supplierMappings,
    locationMappings,
    warnings,
  };
}
