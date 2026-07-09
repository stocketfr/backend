import { Effect } from 'effect';
import type {
  ImportCaches,
  ImportProductRow,
  NormalizedProductImportRow,
  ProductImportResultDto,
} from '../types';
import { isSupportedSortlyPhotoUrl } from '../utils/csv';
import { formatImportError } from '../utils/result';

export interface ProductImportPhotoImporterPort {
  readonly importSortlyPhoto: (
    productId: string,
    url: string,
    photoIndex: number,
    userId: string,
  ) => Effect.Effect<unknown, unknown>;
}

export const pushPhotoImportError = (
  result: ProductImportResultDto,
  row: NormalizedProductImportRow,
  url: string,
  error: string,
) => {
  result.photosSkipped++;
  result.errors.push({
    row: row.sourceRow,
    error: `Photo import failed for "${url}": ${error}`,
  });
};

export const importProductPhotos = (
  photoImporter: ProductImportPhotoImporterPort,
  product: ImportProductRow,
  row: NormalizedProductImportRow,
  caches: ImportCaches,
  result: ProductImportResultDto,
  userId: string,
) =>
  Effect.gen(function* () {
    if (row.photo_urls.length === 0) return;

    let importedUrls = caches.photoUrlsByProduct.get(product.id);
    if (!importedUrls) {
      importedUrls = new Set<string>();
      caches.photoUrlsByProduct.set(product.id, importedUrls);
    }

    for (const [photoIndex, url] of row.photo_urls.entries()) {
      if (importedUrls.has(url)) continue;
      importedUrls.add(url);

      if (!isSupportedSortlyPhotoUrl(url)) {
        pushPhotoImportError(result, row, url, 'Unsupported Sortly photo URL');
        continue;
      }

      yield* photoImporter
        .importSortlyPhoto(product.id, url, photoIndex, userId)
        .pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.sync(() => {
                pushPhotoImportError(
                  result,
                  row,
                  url,
                  formatImportError(error),
                );
              }),
            onSuccess: () =>
              Effect.sync(() => {
                result.photosCreated++;
              }),
          }),
        );
    }
  });
