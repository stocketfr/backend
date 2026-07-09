import { Effect } from 'effect';
import { describe, expect, it } from '@effect/vitest';
import type {
  ImportCaches,
  ImportProductRow,
  NormalizedProductImportRow,
} from '../types';
import { makeEmptyProductImportResult } from '../utils/result';
import {
  importProductPhotos,
  pushPhotoImportError,
  type ProductImportPhotoImporterPort,
} from './photos';

const TEST_USER_ID = '00000000-0000-4000-a000-000000000001';
const now = new Date('2026-01-01T00:00:00.000Z');

const makeCaches = (): ImportCaches => ({
  categories: new Map(),
  locations: new Map(),
  areas: new Map(),
  products: new Map(),
  photoUrlsByProduct: new Map(),
});

const row = (
  overrides: Partial<NormalizedProductImportRow> = {},
): NormalizedProductImportRow => ({
  sourceRow: 2,
  sku: 'SKU-1',
  name: 'Whisky',
  category_path: 'Spirits',
  reorder_point: '',
  quantity: '',
  location: '',
  unit: '',
  standard_price: '',
  barcode: '',
  description: '',
  notes: '',
  is_active: '',
  is_perishable: '',
  expiry_date: '',
  photo_urls: [],
  ...overrides,
});

const product = (): ImportProductRow => ({
  id: 'prod-1',
  tenant_id: 'tenant-1',
  sku: 'SKU-1',
  name: 'Whisky',
  description: null,
  category_id: 'cat-1',
  volume_ml: null,
  weight_kg: null,
  dimensions_cm: null,
  standard_cost: null,
  standard_price: null,
  markup_percentage: null,
  primary_supplier_id: null,
  supplier_sku: null,
  barcode: null,
  unit: null,
  reorder_point: 0,
  is_active: true,
  is_perishable: false,
  notes: null,
  created_at: now,
  updated_at: now,
  deleted_at: null,
  created_by: null,
  updated_by: null,
  deleted_by: null,
});

const makePhotoImporter = (
  failingUrls: ReadonlySet<string> = new Set(),
) => {
  const calls: Array<{
    readonly productId: string;
    readonly url: string;
    readonly photoIndex: number;
    readonly userId: string;
  }> = [];
  const importer: ProductImportPhotoImporterPort = {
    importSortlyPhoto: (productId, url, photoIndex, userId) =>
      Effect.gen(function* () {
        calls.push({ productId, url, photoIndex, userId });
        if (failingUrls.has(url)) {
          return yield* Effect.fail(new Error('download failed'));
        }
        return { id: `photo-${calls.length}` };
      }),
  };
  return { importer, calls };
};

describe('row photo import helpers', () => {
  it('pushes photo import errors in the API result format', () => {
    const result = makeEmptyProductImportResult();

    pushPhotoImportError(
      result,
      row(),
      'https://example.com/image.jpg',
      'Unsupported URL',
    );

    expect(result.photosSkipped).toBe(1);
    expect(result.errors).toEqual([
      {
        row: 2,
        error:
          'Photo import failed for "https://example.com/image.jpg": Unsupported URL',
      },
    ]);
  });

  it.effect('imports supported photos once and records unsupported or failed URLs', () =>
    Effect.gen(function* () {
      const failingUrl = 'https://lnk.sortly.co/fail';
      const { importer, calls } = makePhotoImporter(new Set([failingUrl]));
      const result = makeEmptyProductImportResult();
      const caches = makeCaches();

      yield* importProductPhotos(
        importer,
        product(),
        row({
          photo_urls: [
            'https://lnk.sortly.co/ok',
            failingUrl,
            'https://example.com/nope',
            'https://lnk.sortly.co/ok',
          ],
        }),
        caches,
        result,
        TEST_USER_ID,
      );

      expect(result.photosCreated).toBe(1);
      expect(result.photosSkipped).toBe(2);
      expect(calls).toEqual([
        {
          productId: 'prod-1',
          url: 'https://lnk.sortly.co/ok',
          photoIndex: 0,
          userId: TEST_USER_ID,
        },
        {
          productId: 'prod-1',
          url: failingUrl,
          photoIndex: 1,
          userId: TEST_USER_ID,
        },
      ]);
      expect(result.errors).toEqual([
        {
          row: 2,
          error:
            'Photo import failed for "https://lnk.sortly.co/fail": download failed',
        },
        {
          row: 2,
          error:
            'Photo import failed for "https://example.com/nope": Unsupported Sortly photo URL',
        },
      ]);
    }),
  );
});
