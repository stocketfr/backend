import { parse } from 'csv-parse/sync';
import type {
  CsvParseResult,
  CsvRecord,
  ImportProductRow,
  NormalizedProductImportRow,
  ProductImportAiProposalDto,
  ProductImportDuplicateSkuConflictDto,
  ProductImportErrorDto,
  ProductImportFormat,
  ProductImportInventoryPreviewDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportType,
  ProductImportValues,
  ProductImportWarningDto,
} from './types';
import { suggestLocationMapping } from './storage-location/factory';
import { normalizeStorageLocationName } from './storage-location/utils';

export { normalizeStorageLocationName } from './storage-location/utils';

const normalizedRequiredHeaders = ['sku', 'name', 'category_path'] as const;
const sortlyFolderHeaders = [
  'Primary Folder',
  'Subfolder-level1',
  'Subfolder-level2',
  'Subfolder-level3',
  'Subfolder-level4',
] as const;
const sortlySidHeaders = ['SID', 'Sortly ID (SID)'] as const;
const sortlyPhotoHeaders = [
  'Photo1',
  'Photo2',
  'Photo3',
  'Photo4',
  'Photo5',
  'Photo6',
  'Photo7',
  'Photo8',
] as const;
const supportedSortlyPhotoHosts = new Set(['lnk.sortly.co']);

export const makeEmptyProductImportResult = (): ProductImportResultDto => ({
  categoriesCreated: 0,
  locationsCreated: 0,
  areasCreated: 0,
  productsCreated: 0,
  productsUpdated: 0,
  inventoryRecordsCreated: 0,
  inventoryRecordsUpdated: 0,
  photosCreated: 0,
  photosSkipped: 0,
  rowsSkipped: 0,
  errors: [],
});

const hasAllHeaders = (
  headerSet: ReadonlySet<string>,
  headers: readonly string[],
) => headers.every((header) => headerSet.has(header));

const hasAnyHeader = (
  headerSet: ReadonlySet<string>,
  headers: readonly string[],
) => headers.some((header) => headerSet.has(header));

const isNormalizedProductsCsv = (headers: readonly string[]) => {
  const headerSet = new Set(headers);
  return hasAllHeaders(headerSet, normalizedRequiredHeaders);
};

const isSortlyItemsCsv = (headers: readonly string[]) => {
  const headerSet = new Set(headers);
  return (
    hasAllHeaders(headerSet, ['Entry Type', 'Entry Name']) &&
    hasAnyHeader(headerSet, sortlySidHeaders) &&
    hasAnyHeader(headerSet, sortlyFolderHeaders)
  );
};

export function detectProductImportFormat(
  headers: readonly string[],
  importType: ProductImportType = 'auto',
): ProductImportFormat | null {
  const isNormalized = isNormalizedProductsCsv(headers);
  const isSortly = isSortlyItemsCsv(headers);

  if (importType === 'normalized-products') {
    return isNormalized ? 'normalized-products' : null;
  }

  if (importType === 'sortly-items') {
    return isSortly ? 'sortly-items' : null;
  }

  if (isNormalized) return 'normalized-products';
  if (isSortly) return 'sortly-items';
  return null;
}

export function parseCsvContent(content: string): CsvParseResult {
  let headers: string[] = [];
  const records = parse(content, {
    bom: true,
    columns: (rawHeaders: string[]) => {
      headers = rawHeaders.map((header) => String(header).trim());
      return headers;
    },
    skip_empty_lines: true,
    trim: true,
  }) as CsvRecord[];

  return { headers, records };
}

const readCell = (record: CsvRecord, key: string): string => {
  const value = record[key];
  if (value == null) return '';
  return String(value).trim();
};

const firstCell = (record: CsvRecord, keys: readonly string[]): string => {
  for (const key of keys) {
    const value = readCell(record, key);
    if (value !== '') return value;
  }
  return '';
};

export const normalizeCategoryPath = (categoryPath: string): string => {
  const parts = categoryPath
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'Uncategorized';
};

const normalizeNormalizedRecord = (
  record: CsvRecord,
  sourceRow: number,
): NormalizedProductImportRow => ({
  sourceRow,
  sku: readCell(record, 'sku'),
  name: readCell(record, 'name'),
  category_path: normalizeCategoryPath(readCell(record, 'category_path')),
  reorder_point: readCell(record, 'reorder_point'),
  quantity: readCell(record, 'quantity'),
  location: readCell(record, 'location'),
  unit: readCell(record, 'unit'),
  standard_price: readCell(record, 'standard_price'),
  barcode: readCell(record, 'barcode'),
  description: readCell(record, 'description'),
  notes: readCell(record, 'notes'),
  is_active: readCell(record, 'is_active'),
  is_perishable: readCell(record, 'is_perishable'),
  expiry_date: readCell(record, 'expiry_date'),
  photo_urls: [],
});

export function extractSortlyPhotoUrls(record: CsvRecord): string[] {
  const urls = new Set<string>();
  for (const header of sortlyPhotoHeaders) {
    const value = readCell(record, header);
    if (value !== '') {
      urls.add(value);
    }
  }
  return [...urls];
}

export function isSupportedSortlyPhotoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      supportedSortlyPhotoHosts.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

const normalizeSortlyRecord = (
  record: CsvRecord,
  sourceRow: number,
): NormalizedProductImportRow => {
  const categoryParts = sortlyFolderHeaders
    .map((header) => readCell(record, header))
    .filter(Boolean);
  const expiryDate = readCell(record, 'Expiry Date');
  const qr1 = readCell(record, 'Barcode/QR1-Data');
  const qr2 = readCell(record, 'Barcode/QR2-Data');

  return {
    sourceRow,
    sku: firstCell(record, sortlySidHeaders),
    name: readCell(record, 'Entry Name'),
    category_path:
      categoryParts.length > 0 ? categoryParts.join(' / ') : 'Uncategorized',
    reorder_point: readCell(record, 'Min Level') || '0',
    quantity: readCell(record, 'Quantity') || '0',
    location: readCell(record, 'Location'),
    unit: readCell(record, 'Unit'),
    standard_price: readCell(record, 'Price'),
    barcode: qr1 || qr2,
    description: '',
    notes: readCell(record, 'Notes'),
    is_active: 'true',
    is_perishable: expiryDate === '' ? 'false' : 'true',
    expiry_date: expiryDate,
    photo_urls: extractSortlyPhotoUrls(record),
  };
};

export function normalizeProductImportRecords(
  records: readonly CsvRecord[],
  format: ProductImportFormat,
): NormalizedProductImportRow[] {
  if (format === 'sortly-items') {
    return records.flatMap((record, index) =>
      readCell(record, 'Entry Type') === 'Item'
        ? [normalizeSortlyRecord(record, index + 2)]
        : [],
    );
  }

  return records.map((record, index) =>
    normalizeNormalizedRecord(record, index + 2),
  );
}

export function parseDate(value: string): Date | null {
  const dateStr = value.trim();
  if (!dateStr) return null;

  const slashDateMatch = dateStr.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?:\s*([ap]m))?)?$/i,
  );

  if (slashDateMatch) {
    const dayRaw = slashDateMatch[1];
    const monthRaw = slashDateMatch[2];
    const yearRaw = slashDateMatch[3];
    if (!dayRaw || !monthRaw || !yearRaw) return null;

    const dayNumber = Number.parseInt(dayRaw, 10);
    const monthNumber = Number.parseInt(monthRaw, 10);
    const yearNumber = Number.parseInt(yearRaw, 10);
    const meridiem = slashDateMatch[6]?.toLowerCase();
    const hourRaw = slashDateMatch[4];
    const minuteRaw = slashDateMatch[5];
    let hours = hourRaw ? Number.parseInt(hourRaw, 10) : 0;
    const minutes = minuteRaw ? Number.parseInt(minuteRaw, 10) : 0;

    if (
      !Number.isFinite(dayNumber) ||
      !Number.isFinite(monthNumber) ||
      !Number.isFinite(yearNumber) ||
      !Number.isFinite(hours) ||
      !Number.isFinite(minutes) ||
      monthNumber < 1 ||
      monthNumber > 12 ||
      dayNumber < 1 ||
      dayNumber > 31 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    if (meridiem) {
      if (hours < 1 || hours > 12) return null;
      if (meridiem === 'pm' && hours !== 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;
    } else if (hours < 0 || hours > 23) {
      return null;
    }

    const date = new Date(
      yearNumber,
      monthNumber - 1,
      dayNumber,
      hours,
      minutes,
    );
    if (
      date.getFullYear() !== yearNumber ||
      date.getMonth() !== monthNumber - 1 ||
      date.getDate() !== dayNumber ||
      date.getHours() !== hours ||
      date.getMinutes() !== minutes
    ) {
      return null;
    }
    return date;
  }

  if (dateStr.includes('/')) return null;

  const isoDate = new Date(dateStr);
  return Number.isNaN(isoDate.getTime()) ? null : isoDate;
}

export function parseBoolean(value: string, defaultValue: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return defaultValue;
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function parseProductImportNumber(value: string): number | null {
  const compact = value.trim().replace(/[\s\u00a0']/g, '');
  if (compact === '') return null;

  const commaCount = (compact.match(/,/g) ?? []).length;
  const dotCount = (compact.match(/\./g) ?? []).length;
  const lastComma = compact.lastIndexOf(',');
  const lastDot = compact.lastIndexOf('.');
  let normalized = compact;

  if (commaCount > 0 && dotCount > 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = compact
      .replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
      .replace(decimalSeparator, '.');
  } else if (commaCount > 0) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(compact)
      ? compact.replace(/,/g, '')
      : compact.replace(/,/g, '.');
  } else if (dotCount > 0) {
    normalized = /^\d{1,3}(\.\d{3})+$/.test(compact)
      ? compact.replace(/\./g, '')
      : compact;
  }

  if (normalized === '') return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseInteger(value: string, defaultValue: number): number {
  const parsed = parseProductImportNumber(value);
  return parsed === null ? defaultValue : Math.trunc(parsed);
}

export const nullableText = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export function productDefinitionKey(
  row: NormalizedProductImportRow,
  options: { readonly includeReorderPoint: boolean },
): string {
  const expiryDate = parseDate(row.expiry_date);
  return JSON.stringify({
    name: row.name.trim(),
    category_path: normalizeCategoryPath(row.category_path),
    unit: nullableText(row.unit) ?? '',
    standard_price: parseProductImportNumber(row.standard_price),
    ...(options.includeReorderPoint
      ? { reorder_point: parseInteger(row.reorder_point, 0) }
      : {}),
    barcode: nullableText(row.barcode) ?? '',
    description: nullableText(row.description) ?? '',
    notes: nullableText(row.notes) ?? '',
    is_active: parseBoolean(row.is_active, true),
    is_perishable: parseBoolean(row.is_perishable, Boolean(expiryDate)),
  });
}

const MAX_DERIVED_SKU_LENGTH = 50;

const sanitizeSkuSegment = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const shortHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
};

const fitDerivedSku = (
  sourceSku: string,
  name: string,
  definitionKey: string,
  existingSkus: ReadonlySet<string>,
): string => {
  const sourceSegment = sanitizeSkuSegment(sourceSku) || 'SKU';
  const nameSegment = sanitizeSkuSegment(name) || 'ITEM';
  const readable = `${sourceSegment}-${nameSegment}`;
  if (readable.length <= MAX_DERIVED_SKU_LENGTH && !existingSkus.has(readable)) {
    return readable;
  }

  const hashSuffix = `-${shortHash(definitionKey)}`;
  const prefixLength = MAX_DERIVED_SKU_LENGTH - hashSuffix.length;
  const prefix = readable
    .slice(0, Math.max(1, prefixLength))
    .replace(/-+$/g, '');
  return `${prefix}${hashSuffix}`;
};

export function deriveConflictingDuplicateSkuRows(
  rows: readonly NormalizedProductImportRow[],
  options: { readonly includeReorderPoint?: boolean } = {},
): Map<number, string> {
  const keyOptions = {
    includeReorderPoint: options.includeReorderPoint ?? false,
  };
  const rowsBySku = new Map<string, NormalizedProductImportRow[]>();
  const nonEmptySkus = new Set<string>();

  for (const row of rows) {
    if (!row.sku || !row.name) continue;
    nonEmptySkus.add(row.sku);
    const existing = rowsBySku.get(row.sku) ?? [];
    existing.push(row);
    rowsBySku.set(row.sku, existing);
  }

  const derivedSkusByRow = new Map<number, string>();
  for (const [sku, skuRows] of rowsBySku.entries()) {
    const rowsByDefinition = new Map<
      string,
      readonly NormalizedProductImportRow[]
    >();
    for (const row of skuRows) {
      const definitionKey = productDefinitionKey(row, keyOptions);
      rowsByDefinition.set(definitionKey, [
        ...(rowsByDefinition.get(definitionKey) ?? []),
        row,
      ]);
    }

    if (skuRows.length <= 1 || rowsByDefinition.size <= 1) continue;

    const reservedSkus = new Set(nonEmptySkus);
    reservedSkus.delete(sku);

    for (const [definitionKey, definitionRows] of rowsByDefinition.entries()) {
      const representative = definitionRows[0];
      if (!representative) continue;

      let derivedSku = fitDerivedSku(
        sku,
        representative.name,
        definitionKey,
        reservedSkus,
      );
      let collisionIndex = 1;
      while (reservedSkus.has(derivedSku)) {
        derivedSku = fitDerivedSku(
          sku,
          `${representative.name}-${collisionIndex}`,
          `${definitionKey}:${collisionIndex}`,
          reservedSkus,
        );
        collisionIndex++;
      }
      reservedSkus.add(derivedSku);

      for (const row of definitionRows) {
        derivedSkusByRow.set(row.sourceRow, derivedSku);
      }
    }
  }

  return derivedSkusByRow;
}

export function findConflictingDuplicateSkuRows(
  rows: readonly NormalizedProductImportRow[],
  options: { readonly includeReorderPoint?: boolean } = {},
): Set<number> {
  const conflicts = new Set<number>();
  for (const group of findConflictingDuplicateSkuGroups(rows, options)) {
    group.rows.forEach((row) => conflicts.add(row));
  }
  return conflicts;
}

export function findConflictingDuplicateSkuGroups(
  rows: readonly NormalizedProductImportRow[],
  options: { readonly includeReorderPoint?: boolean } = {},
): ProductImportDuplicateSkuConflictDto[] {
  const keyOptions = {
    includeReorderPoint: options.includeReorderPoint ?? false,
  };
  const definitionsBySku = new Map<
    string,
    {
      readonly rows: number[];
      readonly definitions: Set<string>;
      readonly names: Set<string>;
    }
  >();

  for (const row of rows) {
    if (!row.sku || !row.name) continue;

    const entry = definitionsBySku.get(row.sku) ?? {
      rows: [],
      definitions: new Set<string>(),
      names: new Set<string>(),
    };
    entry.rows.push(row.sourceRow);
    entry.definitions.add(productDefinitionKey(row, keyOptions));
    entry.names.add(row.name.trim());
    definitionsBySku.set(row.sku, entry);
  }

  const conflicts: ProductImportDuplicateSkuConflictDto[] = [];
  for (const [sku, entry] of definitionsBySku.entries()) {
    if (entry.rows.length > 1 && entry.definitions.size > 1) {
      conflicts.push({
        sku,
        rows: [...entry.rows],
        names: [...entry.names].sort((left, right) =>
          left.localeCompare(right),
        ),
      });
    }
  }
  return conflicts.sort((left, right) => left.sku.localeCompare(right.sku));
}

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

const makeWarning = (
  message: string,
  options: {
    readonly row?: number;
    readonly field?: string;
    readonly severity?: ProductImportWarningDto['severity'];
  } = {},
): ProductImportWarningDto => ({
  severity: options.severity ?? 'warning',
  message,
  ...(options.row === undefined ? {} : { row: options.row }),
  ...(options.field === undefined ? {} : { field: options.field }),
});

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
      makeWarning(`${missingRequiredRows.size} rows are missing SKU or name.`, {
        severity: 'error',
      }),
    );
  }
  if (duplicateSkuConflicts.length > 0) {
    warnings.push(
      makeWarning(
        `${duplicateRows.size} rows reuse a SKU for different product definitions.`,
        { severity: 'error', field: 'sku' },
      ),
    );
  }
  if (invalidExpiryRows.size > 0) {
    warnings.push(
      makeWarning(`${invalidExpiryRows.size} rows have invalid expiry dates.`, {
        severity: 'error',
        field: 'expiry_date',
      }),
    );
  }
  const missingLocationRows = rows.filter((row) => !row.location.trim()).length;
  if (missingLocationRows > 0) {
    warnings.push(
      makeWarning(
        `${missingLocationRows} rows have no storage location and will not create inventory records.`,
        { field: 'location' },
      ),
    );
  }
  const uncategorizedRows = categoryCounts.get('Uncategorized') ?? 0;
  if (uncategorizedRows > 0) {
    warnings.push(
      makeWarning(
        `${uncategorizedRows} rows have no category path and need review.`,
        { field: 'category_path' },
      ),
    );
  }
  if (rowsWithUnsupportedPhotos > 0) {
    warnings.push(
      makeWarning(
        `${rowsWithUnsupportedPhotos} Sortly rows include unsupported photo URLs and will skip those photos.`,
        { field: 'photos' },
      ),
    );
  }
  if (locationMappings.some((mapping) => mapping.action === 'create-area')) {
    warnings.push(
      makeWarning(
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
    makeWarning(
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

export const pushRowError = (
  result: ProductImportResultDto,
  row: number,
  error: string,
) => {
  result.rowsSkipped++;
  result.errors.push({ row, error } satisfies ProductImportErrorDto);
};

export const formatImportError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
};

const comparableProductValues = (
  product: ImportProductRow,
  values: ProductImportValues,
) => ({
  name: product.name,
  description: product.description,
  category_id: product.category_id,
  unit: product.unit,
  barcode: product.barcode,
  standard_price: product.standard_price,
  reorder_point: product.reorder_point,
  is_active: product.is_active,
  is_perishable: product.is_perishable,
  notes: product.notes,
  expected_name: values.name,
  expected_description: values.description,
  expected_category_id: values.category_id,
  expected_unit: values.unit,
  expected_barcode: values.barcode,
  expected_standard_price: values.standard_price,
  expected_reorder_point: values.reorder_point,
  expected_is_active: values.is_active,
  expected_is_perishable: values.is_perishable,
  expected_notes: values.notes,
});

export function productValuesMatch(
  product: ImportProductRow,
  values: ProductImportValues,
): boolean {
  const comparison = comparableProductValues(product, values);
  return (
    comparison.name === comparison.expected_name &&
    comparison.description === comparison.expected_description &&
    comparison.category_id === comparison.expected_category_id &&
    comparison.unit === comparison.expected_unit &&
    comparison.barcode === comparison.expected_barcode &&
    comparison.standard_price === comparison.expected_standard_price &&
    comparison.reorder_point === comparison.expected_reorder_point &&
    comparison.is_active === comparison.expected_is_active &&
    comparison.is_perishable === comparison.expected_is_perishable &&
    comparison.notes === comparison.expected_notes
  );
}
