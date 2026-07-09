import type {
  CsvRecord,
  ProductImportFormat,
  ProductImportInventoryPreviewDto,
  ProductImportPreviewDto,
  ProductImportWarningDto,
} from '../types';
import { suggestLocationMapping } from '../storage-location/factory';
import { normalizeStorageLocationName } from '../storage-location/utils';
import {
  isSupportedSortlyPhotoUrl,
  normalizeCategoryPath,
  normalizeProductImportRecords,
} from './csv';
import { findConflictingDuplicateSkuGroups } from './duplicates';
import { parseDate, parseInteger } from './value-parsers';
import { makeImportWarning } from './warnings';

const countBy = <T>(
  values: readonly T[],
  getKey: (value: T) => string,
): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = getKey(value);
    if (key === '') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};

const sortedCountEntries = (counts: ReadonlyMap<string, number>) =>
  [...counts.entries()].sort(
    ([leftValue, leftCount], [rightValue, rightCount]) =>
      rightCount - leftCount || leftValue.localeCompare(rightValue),
  );

export function makeProductImportPreview(
  records: readonly CsvRecord[],
  format: ProductImportFormat,
): ProductImportPreviewDto {
  const rows = normalizeProductImportRecords(records, format);
  const duplicateSkuConflicts = findConflictingDuplicateSkuGroups(rows, {
    includeReorderPoint: format === 'normalized-products',
  });
  const duplicateRows = new Set(
    duplicateSkuConflicts.flatMap((conflict) => [...conflict.rows]),
  );
  const invalidExpiryRows = new Set<number>();
  const missingRequiredRows = new Set<number>();

  for (const row of rows) {
    if (!row.sku || !row.name) {
      missingRequiredRows.add(row.sourceRow);
    }
    if (row.expiry_date.trim() !== '' && parseDate(row.expiry_date) === null) {
      invalidExpiryRows.add(row.sourceRow);
    }
  }

  const blockedRows = new Set([
    ...missingRequiredRows,
    ...duplicateRows,
    ...invalidExpiryRows,
  ]);
  const categoryCounts = countBy(rows, (row) =>
    normalizeCategoryPath(row.category_path),
  );
  const normalizedLocationCounts = countBy(rows, (row) =>
    normalizeStorageLocationName(row.location),
  );
  const categoryMappings = sortedCountEntries(categoryCounts).map(
    ([sourcePath, rowCount]) => {
      const action = sourcePath === 'Uncategorized' ? 'default' : 'create';
      return {
        sourcePath,
        targetPath: sourcePath,
        action,
        rowCount,
      } as const;
    },
  );
  const locationMappings = sortedCountEntries(normalizedLocationCounts).map(
    ([sourceLocation, rowCount]) => ({
      ...suggestLocationMapping(sourceLocation, format),
      rowCount,
    }),
  );
  const inventoryPreviews: ProductImportInventoryPreviewDto[] = rows.map(
    (row) => {
      const locationMapping = row.location
        ? suggestLocationMapping(row.location, format)
        : null;
      const quantity = parseInteger(row.quantity, 0);

      if (missingRequiredRows.has(row.sourceRow)) {
        return {
          row: row.sourceRow,
          sku: row.sku,
          location: row.location,
          quantity,
          action: 'skip',
          reason: 'Missing SKU or name',
        };
      }
      if (duplicateRows.has(row.sourceRow)) {
        return {
          row: row.sourceRow,
          sku: row.sku,
          location: row.location,
          quantity,
          action: 'conflict',
          reason: 'Conflicting duplicate SKU',
        };
      }
      if (invalidExpiryRows.has(row.sourceRow)) {
        return {
          row: row.sourceRow,
          sku: row.sku,
          location: row.location,
          quantity,
          action: 'conflict',
          reason: 'Invalid expiry date',
        };
      }
      if (!row.location.trim()) {
        return {
          row: row.sourceRow,
          sku: row.sku,
          location: row.location,
          quantity,
          action: 'skip',
          reason: 'Missing location',
        };
      }
      return {
        row: row.sourceRow,
        sku: row.sku,
        location: normalizeStorageLocationName(row.location),
        ...(locationMapping?.areaPath
          ? { areaPath: locationMapping.areaPath }
          : {}),
        quantity,
        action: 'create',
      };
    },
  );
  const rowsWithUnsupportedPhotos =
    format === 'sortly-items'
      ? rows.filter((row) =>
          row.photo_urls.some((url) => !isSupportedSortlyPhotoUrl(url)),
        ).length
      : 0;
  const warnings: ProductImportWarningDto[] = [];

  if (missingRequiredRows.size > 0) {
    warnings.push(
      makeImportWarning(
        `${missingRequiredRows.size} rows are missing SKU or name.`,
        {
          severity: 'error',
        },
      ),
    );
  }
  if (duplicateSkuConflicts.length > 0) {
    warnings.push(
      makeImportWarning(
        `${duplicateRows.size} rows reuse a SKU for different product definitions.`,
        { severity: 'error', field: 'sku' },
      ),
    );
  }
  if (invalidExpiryRows.size > 0) {
    warnings.push(
      makeImportWarning(
        `${invalidExpiryRows.size} rows have invalid expiry dates.`,
        {
          severity: 'error',
          field: 'expiry_date',
        },
      ),
    );
  }
  const missingLocationRows = rows.filter((row) => !row.location.trim()).length;
  if (missingLocationRows > 0) {
    warnings.push(
      makeImportWarning(
        `${missingLocationRows} rows have no storage location and will not create inventory records.`,
        { field: 'location' },
      ),
    );
  }
  const uncategorizedRows = categoryCounts.get('Uncategorized') ?? 0;
  if (uncategorizedRows > 0) {
    warnings.push(
      makeImportWarning(
        `${uncategorizedRows} rows have no category path and need review.`,
        { field: 'category_path' },
      ),
    );
  }
  if (rowsWithUnsupportedPhotos > 0) {
    warnings.push(
      makeImportWarning(
        `${rowsWithUnsupportedPhotos} Sortly rows include unsupported photo URLs and will skip those photos.`,
        { field: 'photos' },
      ),
    );
  }
  if (locationMappings.some((mapping) => mapping.action === 'create-area')) {
    warnings.push(
      makeImportWarning(
        'Some storage values look like areas. Pick a default location before import.',
        { field: 'location' },
      ),
    );
  }

  return {
    format,
    totalRows: records.length,
    itemRows: rows.length,
    folderRows: format === 'sortly-items' ? records.length - rows.length : 0,
    importableRows: rows.length - blockedRows.size,
    missingRequiredRows: missingRequiredRows.size,
    duplicateSkuConflicts,
    categoryMappings,
    supplierMappings: [],
    locationMappings,
    inventoryPreviews,
    warnings,
  };
}
