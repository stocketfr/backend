import { parse } from 'csv-parse/sync';
import {
  NORMALIZED_PRODUCT_IMPORT_REQUIRED_HEADERS,
  type NormalizedProductImportRowDto,
  type ProductImportErrorDto,
} from '@stocket/types/products';
import {
  parseBooleanString,
  parseIntegerOrDefault,
  parseIsoOrDmyDateTime,
  parseOptionalFloat,
} from '../../platform/parsing.utils';
import type { ProductImportRow } from './product-import.types';

export class ProductImportCsvParseError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProductImportCsvParseError';
  }
}

type ProductImportRecordResult =
  | { ok: true; value: ProductImportRow }
  | { ok: false; error: ProductImportErrorDto };

export function parseProductImportCsv(
  csvContent: string,
): NormalizedProductImportRowDto[] {
  try {
    return parse(csvContent, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as NormalizedProductImportRowDto[];
  } catch (error) {
    throw new ProductImportCsvParseError('Invalid product import CSV', error);
  }
}

export function normalizeProductImportRecord(
  record: NormalizedProductImportRowDto | undefined,
  rowNumber: number,
): ProductImportRecordResult {
  if (!record) {
    return {
      ok: false,
      error: { row: rowNumber, error: 'Missing row data' },
    };
  }

  const missingRequiredHeaders =
    NORMALIZED_PRODUCT_IMPORT_REQUIRED_HEADERS.filter(
      (header) => !record[header],
    );

  if (missingRequiredHeaders.length > 0) {
    return {
      ok: false,
      error: {
        row: rowNumber,
        error: `Missing required fields: ${missingRequiredHeaders.join(', ')}`,
      },
    };
  }

  const expiryDate = parseIsoOrDmyDateTime(record.expiry_date);

  return {
    ok: true,
    value: {
      sku: record.sku!,
      name: record.name!,
      categoryPath: record.category_path || 'Uncategorized',
      reorderPoint: parseIntegerOrDefault(record.reorder_point, 0),
      quantity: parseIntegerOrDefault(record.quantity, 0),
      locationName: record.location || '',
      unit: record.unit || null,
      standardPrice: parseOptionalFloat(record.standard_price),
      barcode: record.barcode || null,
      description: record.description || null,
      notes: record.notes || null,
      isActive: parseBooleanString(record.is_active, true),
      isPerishable: parseBooleanString(record.is_perishable, !!expiryDate),
      expiryDate,
    },
  };
}
