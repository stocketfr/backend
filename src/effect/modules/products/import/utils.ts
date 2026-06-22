import { Effect } from 'effect';
import { parse } from 'csv-parse/sync';
import { LocationType } from '@stocket/types/locations';
import type { PhotosService } from '../../photos/service';
import {
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products.errors';
import type { ProductImportRepository } from './repository';
import type {
  CsvParseResult,
  CsvRecord,
  ImportAreaRow,
  ImportCaches,
  ImportCategoryRow,
  ImportLocationRow,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  NormalizedProductImportRow,
  ProductImportCommitResultDto,
  ProductImportErrorDto,
  ProductImportFormat,
  ProductImportMappingDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportWarningDto,
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

export const makeEmptyProductImportCommitResult =
  (): ProductImportCommitResultDto => ({
    ...makeEmptyProductImportResult(),
    areasCreated: 0,
    photosImported: 0,
    warnings: [],
  });

export function parseProductImportRequest(
  content: string,
  importType: ImportProductsFromCsvOptions['importType'],
) {
  return Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => parseCsvContent(content),
      catch: (cause) =>
        new ProductImportCsvParseFailed({
          cause,
          messageKey: 'products.importCsvParseFailed',
        }),
    });
    const format = detectProductImportFormat(parsed.headers, importType);
    if (!format) {
      return yield* Effect.fail(
        new ProductImportUnsupportedFormat({
          messageKey: 'products.importUnsupportedFormat',
        }),
      );
    }
    return { parsed, format };
  });
}

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

export const normalizeAreaPath = (areaPath: string): string => {
  const parts = areaPath
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.join(' / ');
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
  area_path: normalizeAreaPath(readCell(record, 'area_path')),
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

const collectSortlyPhotoUrls = (record: CsvRecord): string[] => {
  const urls: string[] = [];
  for (let i = 1; i <= 8; i++) {
    const value = readCell(record, `Photo${i}`);
    if (value !== '') urls.push(value);
  }
  return urls;
};

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
    area_path: '',
    unit: readCell(record, 'Unit'),
    standard_price: readCell(record, 'Price'),
    barcode: qr1 || qr2,
    description: '',
    notes: readCell(record, 'Notes'),
    is_active: 'true',
    is_perishable: expiryDate === '' ? 'false' : 'true',
    expiry_date: expiryDate,
    photo_urls: collectSortlyPhotoUrls(record),
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

const countBy = <T>(values: readonly T[], selector: (value: T) => string) => {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = selector(value).trim();
    if (key === '') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => a.value.localeCompare(b.value));
};

const normalizeKnownLocations = (knownLocations: readonly string[]) =>
  knownLocations
    .map((location) => location.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

const removeLeadingLocationSeparator = (value: string): string =>
  value.replace(/^\s*(?:-|\/|>|:)\s*/, '').trim();

const suggestLocationMapping = (
  source: string,
  knownLocations: readonly string[],
) => {
  const normalizedSource = source.replace(/\s+/g, ' ').trim();
  for (const knownLocation of normalizeKnownLocations(knownLocations)) {
    if (normalizedSource === knownLocation) {
      return { locationName: knownLocation, areaPath: '' };
    }
    if (normalizedSource.startsWith(`${knownLocation} `)) {
      const areaPath = removeLeadingLocationSeparator(
        normalizedSource.slice(knownLocation.length),
      );
      if (areaPath !== '') {
        return {
          locationName: knownLocation,
          areaPath: normalizeAreaPath(areaPath),
        };
      }
    }
  }

  const delimiterMatch = normalizedSource.match(/^(.+?)\s+-\s+(.+)$/);
  if (delimiterMatch) {
    return {
      locationName: delimiterMatch[1]!.trim(),
      areaPath: normalizeAreaPath(delimiterMatch[2]!.trim()),
    };
  }

  return { locationName: normalizedSource, areaPath: '' };
};

export function suggestImportMapping(
  rows: readonly NormalizedProductImportRow[],
  knownLocations: readonly string[] = [],
): ProductImportMappingDto {
  return {
    categoryMappings: countBy(rows, (row) => row.category_path).map(
      ({ value }) => ({ source: value, target: value }),
    ),
    locationMappings: countBy(rows, (row) => row.location).map(({ value }) => ({
      source: value,
      ...suggestLocationMapping(value, knownLocations),
    })),
  };
}

export interface ProductImportMappingLookups {
  readonly categoryMappings: ReadonlyMap<string, string>;
  readonly locationMappings: ReadonlyMap<
    string,
    { readonly locationName: string; readonly areaPath: string }
  >;
}

export function makeProductImportMappingLookups(
  mapping: ProductImportMappingDto | undefined,
): ProductImportMappingLookups | null {
  if (!mapping) return null;

  return {
    categoryMappings: new Map(
      mapping.categoryMappings.map((item) => [
        item.source.trim(),
        item.target.trim(),
      ]),
    ),
    locationMappings: new Map(
      mapping.locationMappings.map((item) => [
        item.source.trim(),
        {
          locationName: item.locationName.trim(),
          areaPath: normalizeAreaPath(item.areaPath),
        },
      ]),
    ),
  };
}

export function applyProductImportMapping(
  row: NormalizedProductImportRow,
  lookups: ProductImportMappingLookups | null,
): { readonly row: NormalizedProductImportRow; readonly error?: string } {
  if (!lookups) return { row };

  const categoryPath = row.category_path.trim();
  const mappedCategory = lookups.categoryMappings.get(categoryPath);
  if (!mappedCategory) {
    return {
      row,
      error: `Missing category mapping for "${categoryPath}"`,
    };
  }

  const locationName = row.location.trim();
  if (locationName === '') {
    return {
      row: {
        ...row,
        category_path: normalizeCategoryPath(mappedCategory),
        area_path: '',
      },
    };
  }

  const mappedLocation = lookups.locationMappings.get(locationName);
  if (!mappedLocation) {
    return {
      row,
      error: `Missing location mapping for "${locationName}"`,
    };
  }

  if (mappedLocation.locationName === '') {
    return {
      row,
      error: `Location mapping for "${locationName}" must include a location`,
    };
  }

  return {
    row: {
      ...row,
      category_path: normalizeCategoryPath(mappedCategory),
      location: mappedLocation.locationName,
      area_path: mappedLocation.areaPath,
    },
  };
}

const isStringRecordArray = (
  value: unknown,
  fields: readonly string[],
): value is Record<string, string>[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      fields.every(
        (field) => typeof (item as Record<string, unknown>)[field] === 'string',
      ),
  );

export function parseProductImportMappingJson(
  value: string,
): ProductImportMappingDto | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !isStringRecordArray(
        (parsed as { categoryMappings?: unknown }).categoryMappings,
        ['source', 'target'],
      ) ||
      !isStringRecordArray(
        (parsed as { locationMappings?: unknown }).locationMappings,
        ['source', 'locationName', 'areaPath'],
      )
    ) {
      return null;
    }

    const mapping = parsed as ProductImportMappingDto;
    return {
      categoryMappings: mapping.categoryMappings.map((item) => ({
        source: item.source.trim(),
        target: normalizeCategoryPath(item.target),
      })),
      locationMappings: mapping.locationMappings.map((item) => ({
        source: item.source.trim(),
        locationName: item.locationName.trim(),
        areaPath: normalizeAreaPath(item.areaPath),
      })),
    };
  } catch {
    return null;
  }
}

export function makeProductImportPreview(
  parsed: CsvParseResult,
  format: ProductImportFormat,
  options: {
    readonly knownLocations?: readonly string[];
    readonly useLlm?: boolean;
  } = {},
): ProductImportPreviewDto {
  const rows = normalizeProductImportRecords(parsed.records, format);
  const issues: ProductImportErrorDto[] = [];
  const warnings: ProductImportWarningDto[] = [];
  const duplicateConflictRows = findConflictingDuplicateSkuRows(rows, {
    includeReorderPoint: format === 'normalized-products',
  });

  for (const row of rows) {
    if (!row.sku || !row.name) {
      issues.push({
        row: row.sourceRow,
        error: 'Cannot import product without sku and name',
      });
    }

    if (duplicateConflictRows.has(row.sourceRow)) {
      issues.push({
        row: row.sourceRow,
        error: `Conflicting duplicate SKU "${row.sku}" has different product fields`,
      });
    }

    const expiryDate = parseDate(row.expiry_date);
    if (row.expiry_date.trim() !== '' && expiryDate === null) {
      issues.push({
        row: row.sourceRow,
        error: `Invalid expiry_date "${row.expiry_date}"`,
      });
    }
  }

  if (options.useLlm) {
    warnings.push({
      warning:
        'AI mapping suggestions are not configured in this environment; deterministic suggestions were used.',
    });
  }

  const itemRows =
    format === 'sortly-items'
      ? parsed.records.filter(
          (record) => readCell(record, 'Entry Type') === 'Item',
        ).length
      : rows.length;
  const folderRows =
    format === 'sortly-items'
      ? parsed.records.filter(
          (record) => readCell(record, 'Entry Type') === 'Folder',
        ).length
      : 0;

  return {
    detectedFormat: format,
    stats: {
      totalRows: parsed.records.length,
      importableRows: rows.length,
      itemRows,
      folderRows,
      rowsMissingSku: rows.filter((row) => row.sku === '').length,
      rowsMissingName: rows.filter((row) => row.name === '').length,
      rowsMissingLocation: rows.filter((row) => row.location === '').length,
      rowsMissingCategory: rows.filter(
        (row) => row.category_path === 'Uncategorized',
      ).length,
      itemsWithPhotos: rows.filter((row) => row.photo_urls.length > 0).length,
      itemsWithBarcodes: rows.filter((row) => row.barcode !== '').length,
    },
    categories: countBy(rows, (row) => row.category_path),
    locations: countBy(rows, (row) => row.location),
    suggestedMapping: suggestImportMapping(rows, options.knownLocations ?? []),
    issues,
    warnings,
  };
}

const getOrCreateCategoryPath = (
  repository: ProductImportRepository,
  categoryPath: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
) =>
  Effect.gen(function* () {
    const parts = normalizeCategoryPath(categoryPath)
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length === 0) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'resolve import category path',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }

    let parentId: string | null = null;
    let categoryId = '';

    for (const part of parts) {
      const cacheKey = `${parentId ?? 'root'}:${part}`;
      const cached = caches.categories.get(cacheKey);
      if (cached) {
        parentId = cached;
        categoryId = cached;
        continue;
      }

      let category: ImportCategoryRow | null =
        yield* repository.findCategoryByNameAndParent(part, parentId);

      if (!category) {
        category = yield* repository.createCategory({
          name: part,
          parent_id: parentId,
          description: 'Imported via product import',
        });
        result.categoriesCreated++;
      }

      caches.categories.set(cacheKey, category.id);
      parentId = category.id;
      categoryId = category.id;
    }

    return categoryId;
  });

const getOrCreateLocation = (
  repository: ProductImportRepository,
  locationName: string,
  caches: ImportCaches,
  result: ProductImportCommitResultDto,
) =>
  Effect.gen(function* () {
    const name = locationName.trim();
    if (name === '') return null;

    const cached = caches.locations.get(name);
    if (cached) return cached;

    let location: ImportLocationRow | null =
      yield* repository.findLocationByName(name);

    if (!location) {
      location = yield* repository.createLocation({
        name,
        type: LocationType.WAREHOUSE,
        address: '',
        contact_person: '',
        phone: '',
        is_active: true,
      });
      result.locationsCreated++;
    }

    caches.locations.set(name, location.id);
    return location.id;
  });

const getOrCreateAreaPath = (
  repository: ProductImportRepository,
  locationId: string,
  areaPath: string,
  caches: ImportCaches,
  result: ProductImportCommitResultDto,
) =>
  Effect.gen(function* () {
    const parts = areaPath
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return null;

    let parentId: string | null = null;
    let areaId = '';

    for (const part of parts) {
      const cacheKey = `${locationId}:${parentId ?? 'root'}:${part}`;
      const cached = caches.areas.get(cacheKey);
      if (cached) {
        parentId = cached;
        areaId = cached;
        continue;
      }

      let area: ImportAreaRow | null =
        yield* repository.findAreaByNameLocationAndParent(
          part,
          locationId,
          parentId,
        );

      if (!area) {
        area = yield* repository.createArea({
          location_id: locationId,
          parent_id: parentId,
          name: part,
          code: '',
          description: 'Imported via product import',
          is_active: true,
        });
        result.areasCreated++;
      }

      caches.areas.set(cacheKey, area.id);
      parentId = area.id;
      areaId = area.id;
    }

    return areaId;
  });

const upsertProduct = (
  repository: ProductImportRepository,
  row: NormalizedProductImportRow,
  categoryId: string,
  caches: ImportCaches,
  result: ProductImportResultDto,
  expiryDate: Date | null,
  userId: string,
) =>
  Effect.gen(function* () {
    const updatedBy = userId;
    const cached = caches.products.get(row.sku);
    if (cached) return cached;

    const values: ProductImportValues = {
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
    };

    const existing = yield* repository.findProductBySku(row.sku);
    if (!existing) {
      const product = yield* repository.createProduct({
        sku: row.sku,
        ...values,
        created_by: updatedBy,
        updated_by: updatedBy,
      });
      result.productsCreated++;
      caches.products.set(row.sku, product);
      return product;
    }

    if (productValuesMatch(existing, values)) {
      caches.products.set(row.sku, existing);
      return existing;
    }

    const product = yield* repository.updateProduct(existing.id, {
      ...values,
      updated_by: updatedBy,
    });
    if (!product) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'update import product',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }
    result.productsUpdated++;
    caches.products.set(row.sku, product);
    return product;
  });

const upsertInventory = (
  repository: ProductImportRepository,
  product: ImportProductRow,
  locationId: string | null,
  areaId: string | null,
  row: NormalizedProductImportRow,
  result: ProductImportCommitResultDto,
  expiryDate: Date | null,
) =>
  Effect.gen(function* () {
    if (!locationId) return;

    const existing = yield* repository.findInventoryByProductLocationArea(
      product.id,
      locationId,
      areaId,
    );
    const quantity = parseInteger(row.quantity, 0);
    if (areaId === null) {
      const hasAreaScopedInventory =
        yield* repository.hasAreaScopedInventoryForProductAndLocation(
          product.id,
          locationId,
        );
      if (hasAreaScopedInventory) {
        return yield* Effect.fail(
          new ProductsInfrastructureError({
            action: 'import root inventory with area-scoped inventory',
            messageKey: 'products.importAreaScopedInventoryConflict',
          }),
        );
      }
    }

    if (!existing) {
      yield* repository.createInventory({
        product_id: product.id,
        location_id: locationId,
        area_id: areaId,
        quantity,
        expiry_date: expiryDate,
      });
      result.inventoryRecordsCreated++;
      return;
    }

    const inventory = yield* repository.updateInventory(existing.id, {
      quantity,
      expiry_date: expiryDate,
    });
    if (!inventory) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'update import inventory',
          messageKey: 'products.repositoryFailed',
        }),
      );
    }
    result.inventoryRecordsUpdated++;
  });

const importPhotosForProduct = (
  photosService: PhotosService,
  product: ImportProductRow,
  row: NormalizedProductImportRow,
  result: ProductImportCommitResultDto,
  userId: string,
  importedPhotoProducts: Set<string>,
) =>
  Effect.gen(function* () {
    if (row.photo_urls.length === 0 || importedPhotoProducts.has(product.id)) {
      return;
    }
    importedPhotoProducts.add(product.id);

    for (const photoUrl of row.photo_urls) {
      const response = yield* Effect.tryPromise({
        try: () => fetch(photoUrl),
        catch: (cause) => cause,
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            pushWarning(
              result,
              `Failed to download Sortly photo ${photoUrl}: ${formatImportError(cause)}`,
              row.sourceRow,
            );
            return null;
          }),
        ),
      );
      if (!response) continue;

      if (!response.ok) {
        pushWarning(
          result,
          `Failed to download Sortly photo ${photoUrl}: HTTP ${response.status}`,
          row.sourceRow,
        );
        continue;
      }

      const contentType =
        response.headers.get('content-type') ?? 'application/octet-stream';
      const arrayBuffer = yield* Effect.tryPromise({
        try: () => response.arrayBuffer(),
        catch: (cause) => cause,
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.sync(() => {
            pushWarning(
              result,
              `Failed to read Sortly photo ${photoUrl}: ${formatImportError(cause)}`,
              row.sourceRow,
            );
            return null;
          }),
        ),
      );
      if (!arrayBuffer) continue;

      const buffer = Buffer.from(arrayBuffer);
      const filename = photoUrl.split('/').pop()?.split('?')[0] || 'sortly-photo';
      yield* photosService
        .uploadPhoto(
          product.id,
          {
            originalname: filename,
            mimetype: contentType,
            size: buffer.length,
            buffer,
          },
          userId,
        )
        .pipe(
          Effect.match({
            onFailure: (error) => {
              pushWarning(
                result,
                `Failed to import Sortly photo ${photoUrl}: ${formatImportError(error)}`,
                row.sourceRow,
              );
            },
            onSuccess: () => {
              result.photosImported++;
            },
          }),
        );
    }
  });

const validateRootInventoryImport = (
  repository: ProductImportRepository,
  row: NormalizedProductImportRow,
  caches: ImportCaches,
) =>
  Effect.gen(function* () {
    const locationName = row.location.trim();
    if (locationName === '' || row.area_path.trim() !== '') return;

    const cachedProduct = caches.products.get(row.sku);
    let product = cachedProduct ?? null;
    if (!product) {
      product = yield* repository.findProductBySku(row.sku);
    }
    if (!product) return;

    let locationId = caches.locations.get(locationName) ?? null;
    if (!locationId) {
      const location = yield* repository.findLocationByName(locationName);
      locationId = location?.id ?? null;
    }
    if (!locationId) return;

    const hasAreaScopedInventory =
      yield* repository.hasAreaScopedInventoryForProductAndLocation(
        product.id,
        locationId,
      );
    if (hasAreaScopedInventory) {
      return yield* Effect.fail(
        new ProductsInfrastructureError({
          action: 'import root inventory with area-scoped inventory',
          messageKey: 'products.importAreaScopedInventoryConflict',
        }),
      );
    }
  });

export function importProductImportRow({
  repository,
  photosService,
  row,
  caches,
  result,
  expiryDate,
  userId,
  importedPhotoProducts,
  importPhotos,
}: {
  readonly repository: ProductImportRepository;
  readonly photosService: PhotosService;
  readonly row: NormalizedProductImportRow;
  readonly caches: ImportCaches;
  readonly result: ProductImportCommitResultDto;
  readonly expiryDate: Date | null;
  readonly userId: string;
  readonly importedPhotoProducts: Set<string>;
  readonly importPhotos: boolean;
}) {
  return Effect.gen(function* () {
    if (row.area_path.trim() !== '' && row.location.trim() === '') {
      return yield* Effect.fail(
        new Error('Cannot import area_path without location'),
      );
    }

    yield* validateRootInventoryImport(repository, row, caches);
    const categoryId = yield* getOrCreateCategoryPath(
      repository,
      row.category_path,
      caches,
      result,
    );
    const product = yield* upsertProduct(
      repository,
      row,
      categoryId,
      caches,
      result,
      expiryDate,
      userId,
    );
    const locationId = yield* getOrCreateLocation(
      repository,
      row.location,
      caches,
      result,
    );
    const areaId = locationId
      ? yield* getOrCreateAreaPath(
          repository,
          locationId,
          row.area_path,
          caches,
          result,
        )
      : null;
    yield* upsertInventory(
      repository,
      product,
      locationId,
      areaId,
      row,
      result,
      expiryDate,
    );
    if (importPhotos) {
      yield* importPhotosForProduct(
        photosService,
        product,
        row,
        result,
        userId,
        importedPhotoProducts,
      );
    }
  });
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

export const pushWarning = (
  result: { warnings: ProductImportWarningDto[] },
  warning: string,
  row?: number,
) => {
  result.warnings.push(
    row === undefined
      ? { warning }
      : ({ row, warning } satisfies ProductImportWarningDto),
  );
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
