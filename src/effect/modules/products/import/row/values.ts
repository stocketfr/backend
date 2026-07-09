import type { NormalizedProductImportRow, ProductImportValues } from '../types';
import {
  nullableText,
  parseBoolean,
  parseInteger,
  parseProductImportNumber,
} from '../utils/value-parsers';

export interface ProductImportProductCreateValues
  extends ProductImportValues {
  readonly sku: string;
  readonly created_by: string;
  readonly updated_by: string;
}

export interface ProductImportProductUpdateValues
  extends ProductImportValues {
  readonly updated_by: string;
}

export const toProductImportValues = (
  row: NormalizedProductImportRow,
  categoryId: string,
  expiryDate: Date | null,
): ProductImportValues => ({
  name: row.name,
  description: nullableText(row.description),
  category_id: categoryId,
  unit: nullableText(row.unit),
  barcode: nullableText(row.barcode),
  standard_price: parseProductImportNumber(row.standard_price),
  reorder_point: parseInteger(row.reorder_point, 0),
  is_active: parseBoolean(row.is_active, true),
  is_perishable: parseBoolean(row.is_perishable, Boolean(expiryDate)),
  notes: nullableText(row.notes),
});
