import * as fs from 'node:fs';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Effect, Layer } from 'effect';
import { DrizzleDatabase, type DrizzleDb } from '../effect/platform/db/drizzle';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../effect/platform/http/request-context';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
} from '../effect/platform/tenancy/tenant-constants';
import * as schema from '../effect/platform/db/schema';
import * as relations from '../effect/platform/db/relations';
import { storageLayer } from '../effect/platform/storage';
import { ProductImportService } from '../effect/modules/products/import/service';
import { getDatabaseUrl } from '../config/db-connection.utils';

interface CliOptions {
  readonly csvFilePath: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly userId: string;
}

const usage = () => {
  console.error(`Usage:
  tsx src/scripts/import-products.ts [--tenant-id <uuid>] <normalized-products.csv>

Environment:
  IMPORT_USER_ID      Required user id to attribute created/updated products to.
  IMPORT_TENANT_ID    Tenant id to scope import writes. Defaults to the default tenant.
  IMPORT_TENANT_NAME  Optional tenant display name for the script request context.
  IMPORT_TENANT_SLUG  Optional tenant slug for the script request context.`);
};

const takeValue = (args: string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

function readOptions(args: string[], env: NodeJS.ProcessEnv): CliOptions {
  let tenantId = env.IMPORT_TENANT_ID ?? DEFAULT_TENANT_ID;
  let csvFilePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help' || arg === 'help') {
      usage();
      process.exit(0);
    }

    if (arg === '--tenant-id') {
      tenantId = takeValue(args, i, arg);
      i++;
      continue;
    }

    if (arg.startsWith('--tenant-id=')) {
      tenantId = arg.slice('--tenant-id='.length);
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (csvFilePath) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }
    csvFilePath = arg;
  }

  if (!csvFilePath) {
    throw new Error('Please provide a CSV file path');
  }

  if (!env.IMPORT_USER_ID) {
    throw new Error('IMPORT_USER_ID is required');
  }

  return {
    csvFilePath,
    tenantId,
    tenantName:
      env.IMPORT_TENANT_NAME ??
      (tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_NAME : tenantId),
    tenantSlug:
      env.IMPORT_TENANT_SLUG ??
      (tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_SLUG : tenantId),
    userId: env.IMPORT_USER_ID,
  };
}

function createDatabase(): { readonly db: DrizzleDb; readonly pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: getDatabaseUrl() });

  const db = drizzle(pool, {
    schema: { ...schema, ...relations },
  }) as unknown as DrizzleDb;

  return { db, pool };
}

function makeScriptRequestContext(options: CliOptions): RequestContext {
  return {
    requestId: '00000000-0000-4000-8000-000000000201',
    path: '/scripts/import-products',
    method: 'POST' as RequestContext['method'],
    ip: null,
    locale: 'en',
    tenantId: options.tenantId,
    tenantName: options.tenantName,
    tenantSlug: options.tenantSlug,
  };
}

function printSummary(result: Awaited<ReturnType<typeof runImport>>) {
  console.log('\nImport completed.\n');
  console.log('Summary:');
  console.log(`  - Categories created: ${result.categoriesCreated}`);
  console.log(`  - Locations created: ${result.locationsCreated}`);
  console.log(`  - Areas created: ${result.areasCreated ?? 0}`);
  console.log(`  - Products created: ${result.productsCreated}`);
  console.log(`  - Products updated: ${result.productsUpdated}`);
  console.log(
    `  - Inventory records created: ${result.inventoryRecordsCreated}`,
  );
  console.log(
    `  - Inventory records updated: ${result.inventoryRecordsUpdated}`,
  );
  console.log(`  - Photos imported: ${result.photosCreated}`);
  console.log(`  - Photos skipped: ${result.photosSkipped}`);
  console.log(`  - Rows skipped: ${result.rowsSkipped}`);

  if (result.errors.length > 0) {
    console.log(`\nErrors encountered: ${result.errors.length}`);
    result.errors.slice(0, 10).forEach((err) => {
      console.log(`  - Row ${err.row}: ${err.error}`);
    });
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more errors`);
    }
  }
}

async function runImport(options: CliOptions) {
  const { db, pool } = createDatabase();

  try {
    const content = fs.readFileSync(options.csvFilePath, 'utf-8');
    const serviceLayer = ProductImportService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(DrizzleDatabase, db),
          Layer.succeed(
            CurrentRequestContext,
            makeScriptRequestContext(options),
          ),
          storageLayer,
        ),
      ),
    );

    return await Effect.runPromise(
      Effect.flatMap(ProductImportService, (service) =>
        service.importFromCsvContent({
          content,
          importType: 'normalized-products',
          userId: options.userId,
        }),
      ).pipe(Effect.provide(serviceLayer)),
    );
  } finally {
    await pool.end();
  }
}

async function main() {
  try {
    const options = readOptions(process.argv.slice(2), process.env);
    if (!fs.existsSync(options.csvFilePath)) {
      throw new Error(`File not found: ${options.csvFilePath}`);
    }

    console.log(
      `Starting product import (normalized-products) for tenant ${options.tenantId}`,
    );
    const result = await runImport(options);
    printSummary(result);
  } catch (error) {
    console.error(
      `\nImport failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    usage();
    process.exit(1);
  }
}

void main();
