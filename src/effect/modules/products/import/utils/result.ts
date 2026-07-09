import type {
  ImportProductRow,
  ProductImportErrorDto,
  ProductImportResultDto,
  ProductImportValues,
} from '../types';

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

export const pushRowError = (
  result: ProductImportResultDto,
  row: number,
  error: string,
) => {
  result.rowsSkipped++;
  result.errors.push({ row, error } satisfies ProductImportErrorDto);
};

export const formatImportError = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (
    error !== null &&
    typeof error === 'object' &&
    !Array.isArray(error) &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim() !== ''
  ) {
    return error.message;
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
