import { parse } from 'csv-parse/sync';
import type {
  CsvParseResult,
  CsvRecord,
  NormalizedProductImportRow,
  ProductImportFormat,
  ProductImportType,
} from '../types';

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
