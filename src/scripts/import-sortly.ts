import * as fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import pg from 'pg';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { LocationType } from '@stocket/types/locations';
import { categories, products, locations, inventory, stockMovements } from '../effect/platform/db/schema';
import { parseDate } from '../effect/modules/products/import/utils';


interface SortlyRecord {
  'Entry Name': string;
  'Variant Details': string;
  'Sortly ID (SID)': string;
  Unit: string;
  'Min Level': string;
  Price: string;
  Value: string;
  Notes: string;
  Tags: string;
  'Barcode/QR1-Data': string;
  'Barcode/QR1-Type': string;
  'Barcode/QR2-Data': string;
  'Barcode/QR2-Type': string;
  'Transaction Date (CEST)': string;
  'Transaction Type': string;
  'QTY change (Quantity Delta)': string;
  'New QTY': string;
  Folder: string;
  'Folder SID': string;
  User: string;
  'Transaction Note': string;
  Location: string;
  'Expiry Date': string;
}

interface ImportStats {
  categoriesCreated: number;
  locationsCreated: number;
  productsCreated: number;
  stockMovementsCreated: number;
  inventoryRecordsCreated: number;
  skippedTransactions: number;
  errors: { row: number; error: string }[];
}

async function createDatabase(): Promise<NodePgDatabase> {
  const pool = new pg.Pool(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PGHOST ?? 'localhost',
          port: Number.parseInt(process.env.PGPORT ?? '5432'),
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE ?? 'stocket_inventory',
        },
  );
  return drizzle(pool);
}

function mapTransactionTypeToReason(
  transactionType: string,
): StockMovementReason {
  const typeMap: Record<string, StockMovementReason> = {
    Create: StockMovementReason.PURCHASE_RECEIVE,
    'Update Quantity': StockMovementReason.COUNT_CORRECTION,
    'Update Quantity (Sold)': StockMovementReason.SALE,
    'Update Quantity (Restocked)': StockMovementReason.PURCHASE_RECEIVE,
    'Update Quantity (Returned)': StockMovementReason.RETURN_FROM_CLIENT,
    'Update Quantity (Stocktake)': StockMovementReason.COUNT_CORRECTION,
    'Update Quantity (Damaged)': StockMovementReason.DAMAGED,
    'Update Quantity (Consumed)': StockMovementReason.SALE,
    Move: StockMovementReason.INTERNAL_TRANSFER,
    'Move (Replenish)': StockMovementReason.INTERNAL_TRANSFER,
    Clone: StockMovementReason.COUNT_CORRECTION,
    Delete: StockMovementReason.WASTE,
  };

  return typeMap[transactionType] ?? StockMovementReason.COUNT_CORRECTION;
}

async function getOrCreateCategory(
  db: NodePgDatabase,
  folderName: string,
  categoryCache: Map<string, string>,
): Promise<string | null> {
  if (!folderName) return null;
  if (categoryCache.has(folderName)) {
    return categoryCache.get(folderName)!;
  }

  const rows = await db.select().from(categories).where(eq(categories.name, folderName)).limit(1);
  let category = rows[0] ?? null;

  if (!category) {
    const [created] = await db.insert(categories).values({
      name: folderName,
      description: `Imported from Sortly`,
    }).returning();
    category = created!;
    console.log(`  ✓ Created category: ${folderName}`);
  }

  categoryCache.set(folderName, category.id);
  return category.id;
}

async function getOrCreateLocation(
  db: NodePgDatabase,
  locationName: string,
  locationCache: Map<string, string>,
): Promise<string | null> {
  if (!locationName) return null;
  if (locationCache.has(locationName)) {
    return locationCache.get(locationName)!;
  }

  const rows = await db.select().from(locations).where(eq(locations.name, locationName)).limit(1);
  let location = rows[0] ?? null;

  if (!location) {
    const [created] = await db.insert(locations).values({
      name: locationName,
      type: LocationType.WAREHOUSE,
      is_active: true,
    }).returning();
    location = created!;
    console.log(`  ✓ Created location: ${locationName}`);
  }

  locationCache.set(locationName, location.id);
  return location.id;
}

async function importSortlyData(
  db: NodePgDatabase,
  csvFilePath: string,
  importUserId: string,
): Promise<ImportStats> {
  const stats: ImportStats = {
    categoriesCreated: 0,
    locationsCreated: 0,
    productsCreated: 0,
    stockMovementsCreated: 0,
    inventoryRecordsCreated: 0,
    skippedTransactions: 0,
    errors: [],
  };

  console.log(`📂 Reading CSV file: ${csvFilePath}`);

  const fileContent = fs.readFileSync(csvFilePath, 'utf-8');
  const records: SortlyRecord[] = parse(fileContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  console.log(`📋 Found ${records.length} transaction records\n`);

  // Caches to avoid duplicate lookups
  const categoryCache = new Map<string, string>();
  const locationCache = new Map<string, string>();
  const productCache = new Map<string, string>(); // SID -> Product ID
  const inventoryCache = new Map<string, string>(); // product_id:location_id -> Inventory ID

  // Process records in order (chronological)
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rowNum = i + 2; // +2 for header row and 0-indexing

    try {
      if (!record) {
        stats.skippedTransactions++;
        continue;
      }

      const sortlyId = record['Sortly ID (SID)'];
      const entryName = record['Entry Name'];
      const folderName = record.Folder;
      const locationName = record.Location;
      const quantityDelta =
        Number.parseFloat(record['QTY change (Quantity Delta)']) || 0;
      const newQty = Number.parseFloat(record['New QTY']) || 0;
      const transactionType = record['Transaction Type'];
      const transactionDate = parseDate(record['Transaction Date (CEST)']);
      const expiryDate = parseDate(record['Expiry Date']);

      if (!sortlyId || !entryName) {
        stats.skippedTransactions++;
        continue;
      }

      // Get or create category
      const categoryId = await getOrCreateCategory(
        db,
        folderName,
        categoryCache,
      );

      // Get or create location
      const locationId = locationName
        ? await getOrCreateLocation(db, locationName, locationCache)
        : null;

      // Check if product exists
      let productId = productCache.get(sortlyId);

      if (!productId) {
        // Try to find existing product by SKU (using Sortly ID as SKU)
        const rows = await db.select().from(products).where(eq(products.sku, sortlyId)).limit(1);
        let product = rows[0] ?? null;

        if (!product) {
          // Create product on first transaction (usually "Create" type)
          if (!categoryId) {
            stats.errors.push({
              row: rowNum,
              error: `Cannot create product without category`,
            });
            stats.skippedTransactions++;
            continue;
          }

          const price = Number.parseFloat(record.Price) || null;

          const [created] = await db.insert(products).values({
            sku: sortlyId,
            name: entryName,
            description: record.Notes || null,
            category_id: categoryId,
            unit: record.Unit || null,
            barcode: record['Barcode/QR1-Data'] || null,
            standard_price: price,
            reorder_point: Number.parseInt(record['Min Level']) || 0,
            is_active: true,
            is_perishable: !!expiryDate,
            created_by: importUserId,
            updated_by: importUserId,
          }).returning();
          product = created!;
          stats.productsCreated++;
          console.log(`  ✓ Created product: ${entryName} (${sortlyId})`);
        }

        productId = product.id;
        productCache.set(sortlyId, productId);
      }

      // Create stock movement
      if (quantityDelta !== 0) {
        const reason = mapTransactionTypeToReason(transactionType);

        await db.insert(stockMovements).values({
          product_id: productId,
          from_location_id: quantityDelta < 0 ? locationId : null,
          to_location_id: quantityDelta > 0 ? locationId : null,
          quantity: Math.abs(quantityDelta),
          reason,
          reference_number: sortlyId,
          user_id: importUserId,
          notes:
            record['Transaction Note'] ||
            `${transactionType} from Sortly import`,
          created_at: transactionDate ?? new Date(),
        });
        stats.stockMovementsCreated++;
      }

      // Update or create inventory record
      if (locationId) {
        const inventoryCacheKey = `${productId}:${locationId}`;
        const inventoryId = inventoryCache.get(inventoryCacheKey);

        if (!inventoryId) {
          // Try to find existing inventory
          const rows = await db.select().from(inventory)
            .where(and(
              eq(inventory.product_id, productId),
              eq(inventory.location_id, locationId),
            ))
            .limit(1);
          const existing = rows[0] ?? null;

          if (!existing) {
            const [created] = await db.insert(inventory).values({
              product_id: productId,
              location_id: locationId,
              quantity: newQty,
              expiry_date: expiryDate,
            }).returning();
            stats.inventoryRecordsCreated++;
            inventoryCache.set(inventoryCacheKey, created!.id);
          } else {
            // Update quantity
            await db.update(inventory).set({
              quantity: newQty,
              ...(expiryDate && { expiry_date: expiryDate }),
            }).where(eq(inventory.id, existing.id));
            inventoryCache.set(inventoryCacheKey, existing.id);
          }
        } else {
          // Update existing inventory
          await db.update(inventory).set({
            quantity: newQty,
            ...(expiryDate && { expiry_date: expiryDate }),
          }).where(eq(inventory.id, inventoryId));
        }
      }

      // Progress indicator
      if ((i + 1) % 100 === 0) {
        console.log(
          `  ⏳ Processed ${i + 1}/${records.length} transactions...`,
        );
      }
    } catch (error) {
      stats.errors.push({
        row: rowNum,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`  ❌ Error on row ${rowNum}:`, error);
    }
  }

  // Final stats
  stats.categoriesCreated = categoryCache.size;
  stats.locationsCreated = locationCache.size;

  return stats;
}

async function main() {
  console.log('🔄 Starting Sortly CSV import...\n');

  const csvFilePath = process.argv[2];

  if (!csvFilePath) {
    console.error('Please provide a CSV file path as an argument');
    console.error('Usage: IMPORT_USER_ID=<user-id> pnpm import:sortly <path-to-csv-file>');
    process.exit(1);
  }

  const importUserId = process.env.IMPORT_USER_ID;
  if (!importUserId) {
    console.error('IMPORT_USER_ID is required');
    process.exit(1);
  }

  if (!fs.existsSync(csvFilePath)) {
    console.error(`❌ File not found: ${csvFilePath}`);
    process.exit(1);
  }

  let db: NodePgDatabase | null = null;

  try {
    db = await createDatabase();
    console.log('✅ Database connected\n');

    const stats = await importSortlyData(db, csvFilePath, importUserId);

    console.log('\n🎉 Import completed!\n');
    console.log('Summary:');
    console.log(`  - Categories created: ${stats.categoriesCreated}`);
    console.log(`  - Locations created: ${stats.locationsCreated}`);
    console.log(`  - Products created: ${stats.productsCreated}`);
    console.log(`  - Stock movements created: ${stats.stockMovementsCreated}`);
    console.log(
      `  - Inventory records created: ${stats.inventoryRecordsCreated}`,
    );
    console.log(`  - Transactions skipped: ${stats.skippedTransactions}`);

    if (stats.errors.length > 0) {
      console.log(`\n⚠️  Errors encountered: ${stats.errors.length}`);
      stats.errors.slice(0, 10).forEach((err) => {
        console.log(`  - Row ${err.row}: ${err.error}`);
      });
      if (stats.errors.length > 10) {
        console.log(`  ... and ${stats.errors.length - 10} more errors`);
      }
    }
  } catch (error) {
    console.error('\n❌ Import failed:', error);
    process.exit(1);
  } finally {
    if (db) {
      const pool = (db as any)._.session?.client;
      if (pool?.end) {
        await pool.end();
      }
      console.log('\n✅ Database connection closed');
    }
  }
}

void main();
