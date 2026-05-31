import {
  normalizeProductImportRecord,
  parseProductImportCsv,
  ProductImportCsvParseError,
} from './product-import-parser';

describe('product import parser', () => {
  it('parses and normalizes a normalized product import row', () => {
    const [record] =
      parseProductImportCsv(`sku,name,category_path,reorder_point,quantity,location,unit,standard_price,barcode,description,notes,is_active,is_perishable,expiry_date
SKU-1,Milk,Foods / Dairy,5,12,Back Room,each,2.50,123456,Fresh milk,Keep cold,yes,,31/01/2026 2:45pm
`);

    const result = normalizeProductImportRecord(record, 2);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      sku: 'SKU-1',
      name: 'Milk',
      categoryPath: 'Foods / Dairy',
      reorderPoint: 5,
      quantity: 12,
      locationName: 'Back Room',
      unit: 'each',
      standardPrice: 2.5,
      barcode: '123456',
      description: 'Fresh milk',
      notes: 'Keep cold',
      isActive: true,
      isPerishable: true,
    });
    expect(result.value.expiryDate?.getFullYear()).toBe(2026);
    expect(result.value.expiryDate?.getMonth()).toBe(0);
    expect(result.value.expiryDate?.getDate()).toBe(31);
    expect(result.value.expiryDate?.getHours()).toBe(14);
    expect(result.value.expiryDate?.getMinutes()).toBe(45);
  });

  it('returns a row error when required import fields are missing', () => {
    const [record] = parseProductImportCsv(`sku,name
SKU-2,
`);

    const result = normalizeProductImportRecord(record, 2);

    expect(result).toEqual({
      ok: false,
      error: {
        row: 2,
        error: 'Missing required fields: name',
      },
    });
  });

  it('wraps CSV parser failures in a product import parse error', () => {
    expect(() => parseProductImportCsv('"unterminated')).toThrow(
      ProductImportCsvParseError,
    );
  });
});
