import type { NormalizedProductImportRow } from '../types';
import { toProductImportValues } from './values';

const row = (
  overrides: Partial<NormalizedProductImportRow> = {},
): NormalizedProductImportRow => ({
  sourceRow: 2,
  sku: 'SKU-1',
  name: 'Whisky',
  category_path: 'Spirits',
  reorder_point: '3',
  quantity: '7',
  location: 'Warehouse',
  unit: ' bottle ',
  standard_price: '12.50',
  barcode: ' BAR-1 ',
  description: ' Imported product ',
  notes: ' Imported note ',
  is_active: 'true',
  is_perishable: '',
  expiry_date: '',
  photo_urls: [],
  ...overrides,
});

describe('toProductImportValues', () => {
  it('normalizes a CSV row into product insert/update values', () => {
    expect(toProductImportValues(row(), 'cat-1', null)).toEqual({
      name: 'Whisky',
      description: 'Imported product',
      category_id: 'cat-1',
      unit: 'bottle',
      barcode: 'BAR-1',
      standard_price: 12.5,
      reorder_point: 3,
      is_active: true,
      is_perishable: false,
      notes: 'Imported note',
    });
  });

  it('uses expiry date as the default perishable signal', () => {
    const expiryDate = new Date('2026-06-01T00:00:00.000Z');

    expect(
      toProductImportValues(
        row({
          is_perishable: '',
          description: ' ',
          unit: '',
          barcode: '',
          notes: '',
          standard_price: '',
          reorder_point: '',
        }),
        'cat-1',
        expiryDate,
      ),
    ).toEqual({
      name: 'Whisky',
      description: null,
      category_id: 'cat-1',
      unit: null,
      barcode: null,
      standard_price: null,
      reorder_point: 0,
      is_active: true,
      is_perishable: true,
      notes: null,
    });
  });
});
