import type {
  ProductImportAiProposalDto,
  ProductImportCategoryMappingDto,
  ProductImportLocationMappingDto,
  ProductImportPreviewDto,
  ProductImportSupplierMappingDto,
  ProductImportWarningDto,
} from '@stocket/types/products';
import { makeProductImportProposal } from '../utils/proposal';
import { decodeRawLlmProposal, type RawLlmProposal } from './raw';
import { isUnknownRecord } from './shared';

const clampConfidence = (
  value: number | undefined,
  fallback: number,
): number => {
  if (value === undefined) return fallback;
  return Math.max(0, Math.min(1, value));
};

const nonNegativeIntegerOr = (
  value: number | undefined,
  fallback: number,
): number => value ?? fallback;

const categoryAction = (
  value: ProductImportCategoryMappingDto['action'] | undefined,
  fallback: ProductImportCategoryMappingDto['action'],
): ProductImportCategoryMappingDto['action'] => value ?? fallback;

const supplierAction = (
  value: ProductImportSupplierMappingDto['action'] | undefined,
): ProductImportSupplierMappingDto['action'] => value ?? 'ignore';

const locationAction = (
  value: ProductImportLocationMappingDto['action'] | undefined,
  fallback: ProductImportLocationMappingDto['action'],
): ProductImportLocationMappingDto['action'] => value ?? fallback;

const warningSeverity = (
  value: ProductImportWarningDto['severity'] | undefined,
): ProductImportWarningDto['severity'] => value ?? 'warning';

const sanitizeWarnings = (
  llmWarnings: RawLlmProposal['warnings'],
  preview: ProductImportPreviewDto,
): ProductImportWarningDto[] => {
  const sanitized = llmWarnings.flatMap((warning) => {
    const message = warning.message;
    if (!message) return [];
    return [
      {
        ...(warning.row !== undefined ? { row: warning.row } : {}),
        ...(warning.field ? { field: warning.field } : {}),
        severity: warningSeverity(warning.severity),
        message,
      } satisfies ProductImportWarningDto,
    ];
  });

  const requiredPreviewWarnings = preview.warnings.filter(
    (warning) => warning.severity === 'error',
  );
  return [...requiredPreviewWarnings, ...sanitized].slice(0, 40);
};

export const sanitizeLlmProposal = (
  raw: unknown,
  preview: ProductImportPreviewDto,
): ProductImportAiProposalDto => {
  const proposal = decodeRawLlmProposal(raw);

  const fallback = makeProductImportProposal(preview);
  const sourceColumn =
    proposal.productIdentity.sourceColumn ||
    fallback.productIdentity.sourceColumn;
  const conflictPolicy =
    proposal.productIdentity.conflictPolicy ??
    fallback.productIdentity.conflictPolicy;

  const rawCategoriesBySource = new Map(
    proposal.categoryMappings.map(
      (mapping) => [mapping.sourcePath, mapping] as const,
    ),
  );
  const categoryMappings = preview.categoryMappings.map((mapping) => {
    const proposed = rawCategoriesBySource.get(mapping.sourcePath);
    if (!proposed)
      return (
        fallback.categoryMappings.find(
          (item) => item.sourcePath === mapping.sourcePath,
        ) ?? mapping
      );
    const targetPath = proposed.targetPath;
    return {
      sourcePath: mapping.sourcePath,
      targetPath: targetPath || mapping.targetPath,
      action: categoryAction(proposed.action, mapping.action),
      rowCount: mapping.rowCount,
    };
  });

  const rawLocationsBySource = new Map(
    proposal.locationMappings.map(
      (mapping) => [mapping.sourceLocation, mapping] as const,
    ),
  );
  const locationMappings = preview.locationMappings.map((mapping) => {
    const proposed = rawLocationsBySource.get(mapping.sourceLocation);
    if (!proposed) return mapping;
    const areaPath = proposed.areaPath;
    const targetLocationName = proposed.targetLocationName;
    return {
      sourceLocation: mapping.sourceLocation,
      ...(targetLocationName ? { targetLocationName } : {}),
      ...(areaPath ? { areaPath } : {}),
      action: locationAction(proposed.action, mapping.action),
      confidence: clampConfidence(proposed.confidence, mapping.confidence),
      rowCount: mapping.rowCount,
    };
  });

  const supplierMappings = proposal.supplierMappings.flatMap((mapping) => {
    const sourcePattern = mapping.sourcePattern;
    const supplierName = mapping.supplierName;
    if (!sourcePattern || !supplierName) return [];
    return [
      {
        sourcePattern,
        supplierName,
        action: supplierAction(mapping.action),
        confidence: clampConfidence(mapping.confidence, 0.5),
        rowCount: nonNegativeIntegerOr(mapping.rowCount, 0),
      } satisfies ProductImportSupplierMappingDto,
    ];
  });

  return {
    format: proposal.format ?? preview.format,
    confidence: clampConfidence(proposal.confidence, fallback.confidence),
    productIdentity: {
      sourceColumn,
      conflictPolicy,
    },
    categoryMappings,
    supplierMappings,
    locationMappings,
    warnings: sanitizeWarnings(proposal.warnings, preview),
  };
};

export const extractResponseText = (json: unknown): string => {
  if (!isUnknownRecord(json)) {
    throw new Error('OpenAI response was not a JSON object');
  }

  if (typeof json.output_text === 'string') return json.output_text;
  const output = Array.isArray(json.output) ? json.output : [];
  for (const item of output) {
    if (!isUnknownRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isUnknownRecord(content)) continue;
      if (typeof content.text === 'string') return content.text;
    }
  }
  throw new Error('OpenAI response did not include output text');
};
