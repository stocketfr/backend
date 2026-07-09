import type { NormalizedProductImportRow, ProductImportPlan } from './types';
import {
  findLocationMapping,
  getDefaultLocationName,
  getSkuConflictPolicy,
  getTargetCategoryPath,
} from './plan';

const row = (
  overrides: Partial<NormalizedProductImportRow> = {},
): NormalizedProductImportRow => ({
  sourceRow: 2,
  sku: 'SKU-1',
  name: 'Spa Oil',
  category_path: 'Spa / Oils',
  reorder_point: '0',
  quantity: '1',
  location: 'Main Warehouse - Shelf 2',
  unit: '',
  standard_price: '',
  barcode: '',
  description: '',
  notes: '',
  is_active: 'true',
  is_perishable: 'false',
  expiry_date: '',
  photo_urls: [],
  ...overrides,
});

describe('product import plan helpers', () => {
  it('reads SKU conflict policy from approved and AI proposal plans', () => {
    expect(
      getSkuConflictPolicy({
        skuConflictPolicy: 'derive-sku',
      } satisfies ProductImportPlan),
    ).toBe('derive-sku');
    expect(
      getSkuConflictPolicy({
        format: 'sortly-items',
        confidence: 0.9,
        productIdentity: {
          sourceColumn: 'SID',
          conflictPolicy: 'reject',
        },
        categoryMappings: [],
        supplierMappings: [],
        locationMappings: [],
        warnings: [],
      } satisfies ProductImportPlan),
    ).toBe('reject');
  });

  it('normalizes mapped category paths', () => {
    const plan = {
      categoryMappings: [
        {
          sourcePath: 'Spa/Oils',
          targetPath: 'Spa Supplies / Oils',
          action: 'create' as const,
          rowCount: 1,
        },
      ],
    } satisfies ProductImportPlan;

    expect(getTargetCategoryPath(row(), plan)).toBe('Spa Supplies / Oils');
  });

  it('matches storage location mappings by normalized source location', () => {
    const mapping = {
      sourceLocation: 'Main Warehouse - Shelf 2',
      action: 'create-area' as const,
      targetLocationName: 'Main Warehouse',
      areaPath: 'Shelf 2',
      confidence: 0.9,
      rowCount: 1,
    };
    const plan = {
      locationMappings: [mapping],
      defaultLocationName: '  Default Warehouse  ',
    } satisfies ProductImportPlan;

    expect(findLocationMapping(row(), plan)).toEqual(mapping);
    expect(getDefaultLocationName(plan)).toBe('Default Warehouse');
  });
});
