export const PRODUCT_IMPORT_MAX_PATH_DEPTH = 10;
export const PRODUCT_IMPORT_MAX_PATH_LENGTH = 1_000;
export const PRODUCT_IMPORT_MAX_PATH_SEGMENT_LENGTH = 100;
export const PRODUCT_IMPORT_MAX_LOCATION_NAME_LENGTH = 100;
export const PRODUCT_IMPORT_MAX_SKU_LENGTH = 50;

export const normalizeProductImportText = (
  value: string,
  maxLength: number,
): string | undefined => {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
};

export const normalizeProductImportPath = (
  value: string,
): string | undefined => {
  const segments = value.split('/').map((segment) => segment.trim());
  if (
    segments.length === 0 ||
    segments.length > PRODUCT_IMPORT_MAX_PATH_DEPTH ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment.length > PRODUCT_IMPORT_MAX_PATH_SEGMENT_LENGTH,
    )
  ) {
    return undefined;
  }
  const normalized = segments.join(' / ');
  return normalized.length <= PRODUCT_IMPORT_MAX_PATH_LENGTH
    ? normalized
    : undefined;
};

export const normalizeProductImportLocationName = (value: string) =>
  normalizeProductImportText(value, PRODUCT_IMPORT_MAX_LOCATION_NAME_LENGTH);

export const normalizeProductImportSku = (value: string) =>
  normalizeProductImportText(value, PRODUCT_IMPORT_MAX_SKU_LENGTH);
