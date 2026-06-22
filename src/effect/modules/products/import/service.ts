import { Effect, Schema } from 'effect';
import { LocationType } from '@stocket/types/locations';
import type { TenantNotResolved } from '../../../platform/tenancy/tenant-context';
import type {
  DuplicateSkuConflict,
  ImportCaches,
  ImportAreaRow,
  ImportCategoryRow,
  ImportLocationRow,
  ImportProductRow,
  ImportProductsFromCsvOptions,
  ImportSupplierRow,
  NormalizedProductImportRow,
  PreviewProductRowsOptions,
  ProductImportAiProposalDto,
  ProductImportApprovedPlanDto,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportValues,
  ProposeProductImportPlanOptions,
} from './types';
import {
  collectDuplicateSkuConflicts,
  detectProductImportFormat,
  formatImportError,
  makeEmptyProductImportResult,
  normalizeCategoryPath,
  normalizeProductImportRecords,
  nullableText,
  parseBoolean,
  parseCsvContent,
  parseDate,
  parseInteger,
  parseProductImportNumber,
  productValuesMatch,
  pushRowError,
} from './utils';
import {
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products.errors';
import { ProductImportRepository } from './repository';

const normalizeImportName = (value: string): string => value.trim();

type PreviewWarning = ProductImportPreviewDto['warnings'][number];
type PreviewCategoryMapping =
  ProductImportPreviewDto['categoryMappings'][number];
type PreviewLocationMapping =
  ProductImportPreviewDto['locationMappings'][number];
type PreviewSupplierMapping =
  ProductImportPreviewDto['supplierMappings'][number];
type PreviewInventory = ProductImportPreviewDto['inventoryPreviews'][number];
type PreviewDuplicateSkuConflict =
  ProductImportPreviewDto['duplicateSkuConflicts'][number];
type ApprovedSupplierMapping = NonNullable<
  ProductImportApprovedPlanDto['supplierMappings']
>[number];

type DecodedProductImportAiProposal = {
  readonly format: ProductImportAiProposalDto['format'];
  readonly confidence: number;
  readonly productIdentity: {
    readonly sourceColumn: string;
    readonly conflictPolicy: ProductImportAiProposalDto['productIdentity']['conflictPolicy'];
  };
  readonly categoryMappings: ReadonlyArray<PreviewCategoryMapping>;
  readonly supplierMappings: ReadonlyArray<PreviewSupplierMapping>;
  readonly locationMappings: ReadonlyArray<PreviewLocationMapping>;
  readonly warnings: ReadonlyArray<PreviewWarning>;
};

const ImportWarningSchema = Schema.Struct({
  row: Schema.optional(Schema.Number),
  field: Schema.optional(Schema.String),
  severity: Schema.Literal('error', 'warning'),
  message: Schema.String,
});

const CategoryMappingSchema = Schema.Struct({
  sourcePath: Schema.String,
  targetCategoryId: Schema.optional(Schema.String),
  targetPath: Schema.String,
  action: Schema.Literal('use-existing', 'create', 'default'),
  rowCount: Schema.Number,
});

const SupplierMappingSchema = Schema.Struct({
  sourcePattern: Schema.String,
  supplierName: Schema.String,
  targetSupplierId: Schema.optional(Schema.String),
  action: Schema.Literal('use-existing', 'create', 'ignore'),
  confidence: Schema.Number,
  rowCount: Schema.Number,
});

const LocationMappingSchema = Schema.Struct({
  sourceLocation: Schema.String,
  targetLocationId: Schema.optional(Schema.String),
  targetLocationName: Schema.optional(Schema.String),
  areaPath: Schema.optional(Schema.String),
  action: Schema.Literal(
    'use-existing',
    'create-location',
    'create-area',
    'ignore',
  ),
  confidence: Schema.Number,
  rowCount: Schema.Number,
});

const ProductImportAiProposalSchema = Schema.Struct({
  format: Schema.Literal('sortly-items', 'normalized-products', 'unknown'),
  confidence: Schema.Number,
  productIdentity: Schema.Struct({
    sourceColumn: Schema.String,
    conflictPolicy: Schema.Literal('reject', 'derive-sku'),
  }),
  categoryMappings: Schema.Array(CategoryMappingSchema),
  supplierMappings: Schema.Array(SupplierMappingSchema),
  locationMappings: Schema.Array(LocationMappingSchema),
  warnings: Schema.Array(ImportWarningSchema),
});

const deriveSkuForConflict = (row: NormalizedProductImportRow): string => {
  const hashInput = `${row.sku}:${row.name}:${row.category_path}:${row.sourceRow}`;
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    hash = (hash * 31 + hashInput.charCodeAt(i)) >>> 0;
  }
  return `${row.sku}-${hash.toString(36).slice(0, 6)}`;
};

const isGenericSupplierCandidate = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  if (/^\d+\s/.test(normalized)) return true;
  return [
    'accessories',
    'amenities, miscellaneous',
    'equipment',
    'minis',
    'spa',
    'table accessories',
  ].includes(normalized);
};

const inferAreaPathFromLocation = (
  locationName: string,
): {
  readonly locationName?: string;
  readonly areaPath?: string;
  readonly confidence: number;
} => {
  const name = locationName.trim();
  const bayShelfMatch = name.match(/^(Bay\s+[A-Z])\s*-\s*(Shelf\s+\d+)$/i);
  if (bayShelfMatch?.[1] && bayShelfMatch[2]) {
    return {
      areaPath: `${bayShelfMatch[1].trim()} / ${bayShelfMatch[2].trim()}`,
      confidence: 0.75,
    };
  }

  const storeRoomBoxMatch = name.match(/^(Store Room)\s*-\s*(Box\s+\d+)$/i);
  if (storeRoomBoxMatch?.[1] && storeRoomBoxMatch[2]) {
    return {
      locationName: storeRoomBoxMatch[1].trim(),
      areaPath: storeRoomBoxMatch[2].trim(),
      confidence: 0.9,
    };
  }

  return { confidence: 0.6 };
};

const findApprovedLocationMapping = (
  plan: ProductImportApprovedPlanDto | undefined,
  sourceLocation: string,
) =>
  plan?.locationMappings?.find(
    (mapping) => mapping.sourceLocation.trim() === sourceLocation.trim(),
  );

const resolveLocationName = (
  row: NormalizedProductImportRow,
  plan: ProductImportApprovedPlanDto | undefined,
): string => {
  const sourceLocation = row.location.trim();
  const mapping = sourceLocation
    ? findApprovedLocationMapping(plan, sourceLocation)
    : undefined;
  if (mapping?.action === 'ignore') return '';
  if (mapping?.targetLocationName) return mapping.targetLocationName;
  if (sourceLocation) return sourceLocation;
  return plan?.defaultLocationName?.trim() ?? '';
};

const resolveAreaPath = (
  row: NormalizedProductImportRow,
  plan: ProductImportApprovedPlanDto | undefined,
): string => {
  const explicit = row.area_path.trim();
  if (explicit) return explicit;
  const mapping = row.location.trim()
    ? findApprovedLocationMapping(plan, row.location)
    : undefined;
  return mapping?.areaPath?.trim() ?? '';
};

const supplierMappingCandidates = (
  row: NormalizedProductImportRow,
): readonly string[] => {
  const explicitSupplier = normalizeImportName(row.supplier_name);
  if (explicitSupplier) {
    return [explicitSupplier.toLowerCase()];
  }

  const firstCategoryPart = normalizeCategoryPath(row.category_path)
    .split('/')[0]
    ?.trim();

  return [firstCategoryPart]
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => candidate.toLowerCase());
};

const findApprovedSupplierMapping = (
  plan: ProductImportApprovedPlanDto | undefined,
  row: NormalizedProductImportRow,
): ApprovedSupplierMapping | undefined => {
  const candidates = supplierMappingCandidates(row);
  if (candidates.length === 0) return undefined;

  return plan?.supplierMappings?.find((mapping) => {
    const sourcePattern = mapping.sourcePattern.trim().toLowerCase();
    const supplierName = mapping.supplierName.trim().toLowerCase();
    return (
      candidates.includes(sourcePattern) || candidates.includes(supplierName)
    );
  });
};

const resolveSupplierName = (
  row: NormalizedProductImportRow,
  mapping: ApprovedSupplierMapping | undefined,
): string => {
  if (mapping?.action === 'ignore') return '';

  const explicitSupplier = normalizeImportName(row.supplier_name);
  if (explicitSupplier) return explicitSupplier;

  return mapping?.supplierName.trim() ?? '';
};

const makeDeterministicProposal = (
  preview: ProductImportPreviewDto,
): ProductImportAiProposalDto => ({
  format: preview.format,
  confidence: 0.5,
  productIdentity: {
    sourceColumn: preview.format === 'sortly-items' ? 'SID' : 'sku',
    conflictPolicy: 'reject',
  },
  categoryMappings: preview.categoryMappings,
  supplierMappings: preview.supplierMappings.map((mapping) => ({
    ...mapping,
    action: mapping.confidence >= 0.9 ? mapping.action : 'ignore',
  })),
  locationMappings: preview.locationMappings,
  warnings: preview.warnings,
});

const toPreviewDuplicateSkuConflict = (
  conflict: DuplicateSkuConflict,
): PreviewDuplicateSkuConflict => ({
  sku: conflict.sku,
  rows: [...conflict.rows],
  names: [...conflict.names],
});

const toProductImportAiProposalDto = (
  proposal: DecodedProductImportAiProposal,
): ProductImportAiProposalDto => ({
  format: proposal.format,
  confidence: proposal.confidence,
  productIdentity: {
    sourceColumn: proposal.productIdentity.sourceColumn,
    conflictPolicy: proposal.productIdentity.conflictPolicy,
  },
  categoryMappings: proposal.categoryMappings.map((mapping) => ({
    ...mapping,
  })),
  supplierMappings: proposal.supplierMappings.map((mapping) => ({
    ...mapping,
  })),
  locationMappings: proposal.locationMappings.map((mapping) => ({
    ...mapping,
  })),
  warnings: proposal.warnings.map((warning) => ({ ...warning })),
});

export class ProductImportService extends Effect.Service<ProductImportService>()(
  '@stocket/effect/products/ProductImportService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* ProductImportRepository;

      const getOrCreateCategoryPath = (
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
        locationName: string,
        caches: ImportCaches,
        result: ProductImportResultDto,
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
        locationId: string,
        areaPath: string,
        caches: ImportCaches,
        result: ProductImportResultDto,
      ) =>
        Effect.gen(function* () {
          if (areaPath.trim() === '') return null;
          const parts = normalizeCategoryPath(areaPath)
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
              yield* repository.findAreaByNameParentAndLocation(
                part,
                parentId,
                locationId,
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
              result.areasCreated = (result.areasCreated ?? 0) + 1;
            }

            caches.areas.set(cacheKey, area.id);
            parentId = area.id;
            areaId = area.id;
          }

          return areaId;
        });

      const findExistingAreaPath = (locationId: string, areaPath: string) =>
        Effect.gen(function* () {
          if (areaPath.trim() === '') return null;
          const parts = normalizeCategoryPath(areaPath)
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean);
          if (parts.length === 0) return null;

          let parentId: string | null = null;
          let areaId: string | null = null;

          for (const part of parts) {
            const area: ImportAreaRow | null =
              yield* repository.findAreaByNameParentAndLocation(
                part,
                parentId,
                locationId,
              );
            if (!area) return null;
            parentId = area.id;
            areaId = area.id;
          }

          return areaId;
        });

      const getOrCreateSupplier = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        result: ProductImportResultDto,
        approvedPlan: ProductImportApprovedPlanDto | undefined,
        allowCreateSuppliers: boolean,
      ) =>
        Effect.gen(function* () {
          const mapping = findApprovedSupplierMapping(approvedPlan, row);
          const name = resolveSupplierName(row, mapping);
          if (name === '') return null;

          if (caches.suppliers.has(name)) {
            return caches.suppliers.get(name) ?? null;
          }

          let supplier: ImportSupplierRow | null =
            yield* repository.findSupplierByName(name);

          const canCreate =
            allowCreateSuppliers &&
            (mapping?.action === 'create' ||
              (mapping === undefined && row.supplier_name.trim() !== ''));

          if (!supplier && canCreate) {
            supplier = yield* repository.createSupplier({
              name,
              notes: 'Imported via product import',
              is_active: true,
            });
            result.suppliersCreated = (result.suppliersCreated ?? 0) + 1;
          }

          caches.suppliers.set(name, supplier?.id ?? null);
          return supplier?.id ?? null;
        });

      const upsertProduct = (
        row: NormalizedProductImportRow,
        categoryId: string,
        supplierId: string | null,
        caches: ImportCaches,
        result: ProductImportResultDto,
        expiryDate: Date | null,
        userId: string,
      ) =>
        Effect.gen(function* () {
          const updatedBy = userId;
          const cached = caches.products.get(row.sku);
          if (cached) return cached;

          const existing = yield* repository.findProductBySku(row.sku);
          const standardCost =
            row.supplier_cost.trim() !== ''
              ? parseProductImportNumber(row.supplier_cost)
              : (existing?.standard_cost ?? null);
          const primarySupplierId =
            supplierId ?? existing?.primary_supplier_id ?? null;
          const supplierSku =
            row.supplier_sku.trim() !== ''
              ? nullableText(row.supplier_sku)
              : (existing?.supplier_sku ?? null);

          const values: ProductImportValues = {
            name: row.name,
            description: nullableText(row.description),
            category_id: categoryId,
            standard_cost: standardCost,
            unit: nullableText(row.unit),
            barcode: nullableText(row.barcode),
            standard_price: parseProductImportNumber(row.standard_price),
            reorder_point: parseInteger(row.reorder_point, 0),
            primary_supplier_id: primarySupplierId,
            supplier_sku: supplierSku,
            is_active: parseBoolean(row.is_active, true),
            is_perishable: parseBoolean(row.is_perishable, Boolean(expiryDate)),
            notes: nullableText(row.notes),
          };

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
        product: ImportProductRow,
        locationId: string | null,
        areaId: string | null,
        row: NormalizedProductImportRow,
        result: ProductImportResultDto,
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

      const validateRootInventoryImport = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        approvedPlan: ProductImportApprovedPlanDto | undefined,
      ) =>
        Effect.gen(function* () {
          if (resolveAreaPath(row, approvedPlan) !== '') return;
          const locationName = resolveLocationName(row, approvedPlan);
          if (locationName === '') return;

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

      const importRow = (
        row: NormalizedProductImportRow,
        caches: ImportCaches,
        result: ProductImportResultDto,
        expiryDate: Date | null,
        userId: string,
        approvedPlan: ProductImportApprovedPlanDto | undefined,
        allowCreateSuppliers: boolean,
      ) =>
        Effect.gen(function* () {
          yield* validateRootInventoryImport(row, caches, approvedPlan);
          const categoryId = yield* getOrCreateCategoryPath(
            row.category_path,
            caches,
            result,
          );
          const supplierId = yield* getOrCreateSupplier(
            row,
            caches,
            result,
            approvedPlan,
            allowCreateSuppliers,
          );
          const product = yield* upsertProduct(
            row,
            categoryId,
            supplierId,
            caches,
            result,
            expiryDate,
            userId,
          );
          const locationId = yield* getOrCreateLocation(
            resolveLocationName(row, approvedPlan),
            caches,
            result,
          );
          const areaId = locationId
            ? yield* getOrCreateAreaPath(
                locationId,
                resolveAreaPath(row, approvedPlan),
                caches,
                result,
              )
            : null;
          yield* upsertInventory(
            product,
            locationId,
            areaId,
            row,
            result,
            expiryDate,
          );
        });

      const previewCsvContent = ({
        content,
        importType = 'auto',
      }: PreviewProductRowsOptions): Effect.Effect<
        ProductImportPreviewDto,
        | ProductImportCsvParseFailed
        | ProductImportUnsupportedFormat
        | ProductsInfrastructureError
        | TenantNotResolved
      > =>
        Effect.gen(function* () {
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

          const rows = normalizeProductImportRecords(parsed.records, format);
          const duplicateSkuConflicts = collectDuplicateSkuConflicts(rows, {
            includeReorderPoint: format === 'normalized-products',
          });
          const duplicateConflictRows = new Set(
            duplicateSkuConflicts.flatMap((conflict) => [...conflict.rows]),
          );
          const warnings: PreviewWarning[] = [];
          const categoryCounts = new Map<string, number>();
          const locationCounts = new Map<string, number>();
          const supplierCounts = new Map<string, number>();
          const inventoryPreviews: PreviewInventory[] = [];
          let missingRequiredRows = 0;

          for (const conflict of duplicateSkuConflicts) {
            warnings.push({
              severity: 'error',
              message: `Conflicting duplicate SKU "${conflict.sku}" has different product fields`,
            });
          }

          for (const row of rows) {
            if (!row.sku || !row.name) {
              missingRequiredRows++;
              warnings.push({
                row: row.sourceRow,
                severity: 'error',
                message: 'Cannot import product without sku and name',
              });
              continue;
            }

            const categoryPath = normalizeCategoryPath(row.category_path);
            categoryCounts.set(
              categoryPath,
              (categoryCounts.get(categoryPath) ?? 0) + 1,
            );

            const locationName = row.location.trim();
            if (locationName) {
              locationCounts.set(
                locationName,
                (locationCounts.get(locationName) ?? 0) + 1,
              );
            } else {
              warnings.push({
                row: row.sourceRow,
                field: 'location',
                severity: 'warning',
                message:
                  'Inventory row has no location and will not create inventory',
              });
            }

            const supplierName = row.supplier_name.trim();
            if (supplierName) {
              supplierCounts.set(
                supplierName,
                (supplierCounts.get(supplierName) ?? 0) + 1,
              );
            } else {
              const firstCategoryPart =
                categoryPath.split('/')[0]?.trim() ?? '';
              if (!isGenericSupplierCandidate(firstCategoryPart)) {
                supplierCounts.set(
                  firstCategoryPart,
                  (supplierCounts.get(firstCategoryPart) ?? 0) + 1,
                );
              }
            }

            if (row.standard_price.trim() === '') {
              warnings.push({
                row: row.sourceRow,
                field: 'standard_price',
                severity: 'warning',
                message: 'Product price is missing',
              });
            }

            const expiryDate = parseDate(row.expiry_date);
            if (row.expiry_date.trim() !== '' && expiryDate === null) {
              warnings.push({
                row: row.sourceRow,
                field: 'expiry_date',
                severity: 'error',
                message: `Invalid expiry_date "${row.expiry_date}"`,
              });
            }

            if (!locationName) {
              inventoryPreviews.push({
                row: row.sourceRow,
                sku: row.sku,
                location: '',
                quantity: parseInteger(row.quantity, 0),
                action: 'skip',
                reason: 'Missing location',
              });
              continue;
            }

            if (duplicateConflictRows.has(row.sourceRow)) {
              inventoryPreviews.push({
                row: row.sourceRow,
                sku: row.sku,
                location: locationName,
                areaPath: row.area_path.trim() || undefined,
                quantity: parseInteger(row.quantity, 0),
                action: 'conflict',
                reason: 'Conflicting duplicate SKU',
              });
              continue;
            }

            const product = yield* repository.findProductBySku(row.sku);
            const location = yield* repository.findLocationByName(locationName);
            if (!product || !location) {
              inventoryPreviews.push({
                row: row.sourceRow,
                sku: row.sku,
                location: locationName,
                areaPath: row.area_path.trim() || undefined,
                quantity: parseInteger(row.quantity, 0),
                action: 'create',
                reason: !product
                  ? 'Product will be created'
                  : 'Location will be created',
              });
              continue;
            }

            const areaPath = row.area_path.trim();
            const areaId = areaPath
              ? yield* findExistingAreaPath(location.id, areaPath)
              : null;

            if (!areaPath) {
              const hasAreaScopedInventory =
                yield* repository.hasAreaScopedInventoryForProductAndLocation(
                  product.id,
                  location.id,
                );
              if (hasAreaScopedInventory) {
                inventoryPreviews.push({
                  row: row.sourceRow,
                  sku: row.sku,
                  location: locationName,
                  quantity: parseInteger(row.quantity, 0),
                  action: 'conflict',
                  reason:
                    'Cannot import root inventory while area-scoped inventory exists',
                });
                continue;
              }
            }

            const existing = areaPath
              ? areaId
                ? yield* repository.findInventoryByProductLocationArea(
                    product.id,
                    location.id,
                    areaId,
                  )
                : null
              : yield* repository.findRootInventoryByProductAndLocation(
                  product.id,
                  location.id,
                );
            inventoryPreviews.push({
              row: row.sourceRow,
              sku: row.sku,
              location: locationName,
              areaPath: areaPath || undefined,
              quantity: parseInteger(row.quantity, 0),
              action: existing ? 'update' : 'create',
              reason: areaPath && !areaId ? 'Area will be created' : undefined,
            });
          }

          const categoryMappings: PreviewCategoryMapping[] = [];
          for (const [sourcePath, rowCount] of categoryCounts.entries()) {
            const parts = normalizeCategoryPath(sourcePath)
              .split('/')
              .map((part) => part.trim())
              .filter(Boolean);
            let parentId: string | null = null;
            let targetCategoryId: string | undefined;
            let action: PreviewCategoryMapping['action'] = 'use-existing';

            for (const part of parts) {
              const category: ImportCategoryRow | null =
                yield* repository.findCategoryByNameAndParent(part, parentId);
              if (!category) {
                action = sourcePath === 'Uncategorized' ? 'default' : 'create';
                targetCategoryId = undefined;
                break;
              }
              parentId = category.id;
              targetCategoryId = category.id;
            }

            categoryMappings.push({
              sourcePath,
              targetCategoryId,
              targetPath: normalizeCategoryPath(sourcePath),
              action,
              rowCount,
            });
          }

          const locationMappings: PreviewLocationMapping[] = [];
          for (const [sourceLocation, rowCount] of locationCounts.entries()) {
            const existing =
              yield* repository.findLocationByName(sourceLocation);
            const inferred = inferAreaPathFromLocation(sourceLocation);
            locationMappings.push({
              sourceLocation,
              targetLocationId: existing?.id,
              targetLocationName: inferred.locationName ?? existing?.name,
              areaPath: inferred.areaPath,
              action: existing
                ? inferred.areaPath
                  ? 'create-area'
                  : 'use-existing'
                : inferred.areaPath
                  ? 'create-area'
                  : 'create-location',
              confidence: inferred.confidence,
              rowCount,
            });
          }

          const supplierMappings: PreviewSupplierMapping[] = [];
          for (const [supplierName, rowCount] of supplierCounts.entries()) {
            const existing = yield* repository.findSupplierByName(supplierName);
            supplierMappings.push({
              sourcePattern: supplierName,
              supplierName,
              targetSupplierId: existing?.id,
              action: existing ? 'use-existing' : 'create',
              confidence: format === 'sortly-items' ? 0.55 : 0.95,
              rowCount,
            });
          }

          const itemRows =
            format === 'sortly-items'
              ? parsed.records.filter(
                  (record) =>
                    String(record['Entry Type'] ?? '').trim() === 'Item',
                ).length
              : rows.length;
          const folderRows =
            format === 'sortly-items'
              ? parsed.records.filter(
                  (record) =>
                    String(record['Entry Type'] ?? '').trim() === 'Folder',
                ).length
              : 0;

          return {
            format,
            totalRows: parsed.records.length,
            itemRows,
            folderRows,
            importableRows: rows.length,
            missingRequiredRows,
            duplicateSkuConflicts: duplicateSkuConflicts.map(
              toPreviewDuplicateSkuConflict,
            ),
            categoryMappings,
            supplierMappings,
            locationMappings,
            inventoryPreviews,
            warnings,
          };
        }).pipe(Effect.withSpan('ProductImportService.previewCsvContent'));

      const proposeImportPlan = ({
        content,
        importType = 'auto',
      }: ProposeProductImportPlanOptions): Effect.Effect<
        ProductImportAiProposalDto,
        | ProductImportCsvParseFailed
        | ProductImportUnsupportedFormat
        | ProductsInfrastructureError
        | TenantNotResolved
      > =>
        Effect.gen(function* () {
          const preview = yield* previewCsvContent({ content, importType });
          const apiKey = process.env.OPENAI_API_KEY;
          const isEnabled =
            process.env.PRODUCT_IMPORT_AI_ENABLED?.toLowerCase() === 'true';
          if (!isEnabled || !apiKey) {
            return makeDeterministicProposal(preview);
          }

          const sampleLines = content.split(/\r?\n/).slice(0, 25).join('\n');
          const endpoint =
            process.env.PRODUCT_IMPORT_AI_ENDPOINT ??
            'https://api.openai.com/v1/chat/completions';
          const model = process.env.PRODUCT_IMPORT_AI_MODEL ?? 'gpt-4.1-mini';

          const proposalJson = yield* Effect.tryPromise({
            try: async () => {
              const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                  authorization: `Bearer ${apiKey}`,
                  'content-type': 'application/json',
                },
                body: JSON.stringify({
                  model,
                  response_format: { type: 'json_object' },
                  messages: [
                    {
                      role: 'system',
                      content:
                        'Return only JSON matching the requested import proposal schema. Do not invent writes; mark low-confidence supplier mappings as ignore.',
                    },
                    {
                      role: 'user',
                      content: JSON.stringify({
                        task: 'Propose a reviewable product import mapping plan.',
                        preview,
                        csvSample: sampleLines,
                        schema:
                          'ProductImportAiProposalDto with format, confidence, productIdentity, categoryMappings, supplierMappings, locationMappings, warnings.',
                      }),
                    },
                  ],
                }),
              });
              if (!response.ok) {
                throw new Error(
                  `AI proposal request failed with status ${response.status}`,
                );
              }
              const body = (await response.json()) as {
                choices?: Array<{ message?: { content?: string } }>;
              };
              const contentText = body.choices?.[0]?.message?.content;
              if (!contentText) {
                throw new Error('AI proposal response did not include content');
              }
              return JSON.parse(contentText) as unknown;
            },
            catch: (cause) =>
              new ProductsInfrastructureError({
                action: 'generate product import AI proposal',
                cause,
                messageKey: 'products.repositoryFailed',
              }),
          });

          const decodedProposal = yield* Schema.decodeUnknown(
            ProductImportAiProposalSchema,
          )(proposalJson).pipe(
            Effect.mapError(
              (cause) =>
                new ProductsInfrastructureError({
                  action: 'validate product import AI proposal',
                  cause,
                  messageKey: 'products.repositoryFailed',
                }),
            ),
          );
          return toProductImportAiProposalDto(decodedProposal);
        }).pipe(Effect.withSpan('ProductImportService.proposeImportPlan'));

      const importFromCsvContent = ({
        content,
        importType = 'auto',
        userId,
        approvedPlan,
        allowCreateSuppliers = approvedPlan?.allowCreateSuppliers ?? false,
      }: ImportProductsFromCsvOptions): Effect.Effect<
        ProductImportResultDto,
        ProductImportCsvParseFailed | ProductImportUnsupportedFormat
      > =>
        Effect.gen(function* () {
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

          const result = makeEmptyProductImportResult();
          const rows = normalizeProductImportRecords(parsed.records, format);
          const duplicateConflicts = collectDuplicateSkuConflicts(rows, {
            includeReorderPoint: format === 'normalized-products',
          });
          const duplicateConflictRows = new Set(
            duplicateConflicts.flatMap((conflict) => [...conflict.rows]),
          );
          const duplicateConflictPolicy =
            approvedPlan?.skuConflictPolicy ?? 'reject';
          const caches: ImportCaches = {
            categories: new Map<string, string>(),
            locations: new Map<string, string>(),
            areas: new Map<string, string>(),
            suppliers: new Map<string, string | null>(),
            products: new Map<string, ImportProductRow>(),
          };

          for (const row of rows) {
            const activeRow =
              duplicateConflictPolicy === 'derive-sku' &&
              duplicateConflictRows.has(row.sourceRow)
                ? { ...row, sku: deriveSkuForConflict(row) }
                : row;

            if (!row.sku || !row.name) {
              pushRowError(
                result,
                row.sourceRow,
                'Cannot import product without sku and name',
              );
              continue;
            }

            if (
              duplicateConflictRows.has(row.sourceRow) &&
              duplicateConflictPolicy === 'reject'
            ) {
              pushRowError(
                result,
                row.sourceRow,
                `Conflicting duplicate SKU "${row.sku}" has different product fields`,
              );
              continue;
            }

            const expiryDate = parseDate(row.expiry_date);
            if (row.expiry_date.trim() !== '' && expiryDate === null) {
              pushRowError(
                result,
                row.sourceRow,
                `Invalid expiry_date "${row.expiry_date}"`,
              );
              continue;
            }

            yield* importRow(
              activeRow,
              caches,
              result,
              expiryDate,
              userId,
              approvedPlan,
              allowCreateSuppliers,
            ).pipe(
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  pushRowError(result, row.sourceRow, formatImportError(error));
                }),
              ),
            );
          }

          return result;
        }).pipe(Effect.withSpan('ProductImportService.importFromCsvContent'));

      return {
        importFromCsvContent,
        previewCsvContent,
        proposeImportPlan,
      };
    }),
    dependencies: [ProductImportRepository.Default],
  },
) {}
