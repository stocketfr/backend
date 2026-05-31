import type { ProductImportResultDto } from '@stocket/types/products';
import type { DrizzleDb } from '../../platform/db/drizzle';
import {
  normalizeProductImportRecord,
  parseProductImportCsv,
  ProductImportCsvParseError,
} from './product-import-parser';
import { makeProductImportStore } from './product-import-store';
import type {
  ImportProductsOptions,
  ProductImportLogger,
} from './product-import.types';

export type { ImportProductsOptions, ProductImportLogger };
export { ProductImportCsvParseError };

const DEFAULT_IMPORT_USER_ID = 'import_products_user';

function createEmptyStats(): ProductImportResultDto {
  return {
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
    succeeded: [],
  };
}

function skipRow(
  stats: ProductImportResultDto,
  row: number,
  error: string,
): void {
  stats.errors.push({ row, error });
  stats.rowsSkipped++;
}

export async function importNormalizedProductsCsv(
  db: DrizzleDb,
  csvContent: string,
  options: ImportProductsOptions,
): Promise<ProductImportResultDto> {
  const stats = createEmptyStats();
  const records = parseProductImportCsv(csvContent);
  const userId = options.userId ?? DEFAULT_IMPORT_USER_ID;
  const store = makeProductImportStore({
    db,
    tenantId: options.tenantId,
    stats,
    logger: options.logger,
  });

  for (let i = 0; i < records.length; i++) {
    const rowNumber = i + 2;
    const result = normalizeProductImportRecord(records[i], rowNumber);

    if (!result.ok) {
      skipRow(stats, result.error.row, result.error.error);
      continue;
    }

    try {
      const categoryId = await store.getOrCreateCategoryPath(
        result.value.categoryPath,
      );
      const product = await store.upsertProduct({
        categoryId,
        row: result.value,
        userId,
      });

      stats.succeeded.push(product.id);
      await store.syncInventory(product.id, result.value);

      if ((i + 1) % 100 === 0) {
        options.logger?.info(`Processed ${i + 1}/${records.length} rows`);
      }
    } catch (error) {
      skipRow(
        stats,
        rowNumber,
        error instanceof Error ? error.message : String(error),
      );
      options.logger?.error(`Error on row ${rowNumber}`, error);
    }
  }

  return stats;
}
