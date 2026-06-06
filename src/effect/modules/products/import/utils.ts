import { parse } from 'csv-parse/sync';
import type {
  CsvParseResult,
  CsvRecord,
  ImportProductRow,
  NormalizedProductImportRow,
  ProductImportErrorDto,
  ProductImportFormat,
  ProductImportResultDto,
  ProductImportType,
  ProductImportValues,
} from './types';

const normalizedRequiredHeaders = ['sku', 'name', 'category_path'] as const;
const sortlyFolderHeaders = [
  'Primary Folder',
  'Subfolder-level1',
  'Subfolder-level2',
  'Subfolder-level3',
  'Subfolder-level4',
] as const;
const sortlySidHeaders = ['SID', 'Sortly ID (SID)'] as const;

export const makeEmptyProductImportResult = (): ProductImportResultDto => ({
  categoriesCreated: 0,
  locationsCreated: 0,
  productsCreated: 0,
  productsUpdated: 0,
  inventoryRecordsCreated: 0,
  inventoryRecordsUpdated: 0,
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
});

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

function productDefinitionKey(
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

export function findConflictingDuplicateSkuRows(
  rows: readonly NormalizedProductImportRow[],
  options: { readonly includeReorderPoint?: boolean } = {},
): Set<number> {
  const keyOptions = {
    includeReorderPoint: options.includeReorderPoint ?? false,
  };
  const definitionsBySku = new Map<
    string,
    { readonly rows: number[]; readonly definitions: Set<string> }
  >();

  for (const row of rows) {
    if (!row.sku || !row.name) continue;

    const entry = definitionsBySku.get(row.sku) ?? {
      rows: [],
      definitions: new Set<string>(),
    };
    entry.rows.push(row.sourceRow);
    entry.definitions.add(productDefinitionKey(row, keyOptions));
    definitionsBySku.set(row.sku, entry);
  }

  const conflicts = new Set<number>();
  for (const entry of definitionsBySku.values()) {
    if (entry.rows.length > 1 && entry.definitions.size > 1) {
      entry.rows.forEach((row) => conflicts.add(row));
    }
  }
  return conflicts;
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
