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
import { ProductImportService } from '../effect/modules/products/import/service';
import {
  ProductImportTypes,
  type ProductImportAiProposalDto,
  type ProductImportApprovedPlanDto,
  type ProductImportPreviewDto,
  type ProductImportResultDto,
  type ProductImportType,
} from '../effect/modules/products/import/types';
import { getDatabaseUrl } from '../config/db-connection.utils';

const SCRIPT_PREVIEW_USER_ID = '00000000-0000-4000-a000-000000000202';

interface CliOptions {
  readonly csvFilePath: string;
  readonly importType: ProductImportType;
  readonly mode: 'import' | 'preview' | 'propose';
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantSlug: string;
  readonly userId: string;
  readonly approvedPlanPath?: string;
  readonly allowCreateSuppliers: boolean;
}

const usage = () => {
  console.error(`Usage:
  tsx src/scripts/import-products.ts [--import-type auto|normalized-products|sortly-items] [--tenant-id <uuid>] <csv-file>
  tsx src/scripts/import-products.ts --preview [--import-type auto|normalized-products|sortly-items] <csv-file>
  tsx src/scripts/import-products.ts --propose [--import-type auto|normalized-products|sortly-items] <csv-file>

Environment:
  IMPORT_USER_ID      Required for import mode to attribute created/updated products to.
  IMPORT_TENANT_ID    Tenant id to scope import writes. Defaults to the default tenant.
  IMPORT_TENANT_NAME  Optional tenant display name for the script request context.
  IMPORT_TENANT_SLUG  Optional tenant slug for the script request context.`);
};

const isImportType = (value: string): value is ProductImportType =>
  ProductImportTypes.includes(value as ProductImportType);

const takeValue = (args: string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

function readOptions(args: string[], env: NodeJS.ProcessEnv): CliOptions {
  let importType: ProductImportType = 'auto';
  let mode: CliOptions['mode'] = 'import';
  let tenantId = env.IMPORT_TENANT_ID ?? DEFAULT_TENANT_ID;
  let approvedPlanPath: string | undefined;
  let allowCreateSuppliers = false;
  let csvFilePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '-h' || arg === '--help' || arg === 'help') {
      usage();
      process.exit(0);
    }

    if (arg === '--import-type') {
      const value = takeValue(args, i, arg);
      if (!isImportType(value)) {
        throw new Error(`Unknown import type: ${value}`);
      }
      importType = value;
      i++;
      continue;
    }

    if (arg === '--preview') {
      mode = 'preview';
      continue;
    }

    if (arg === '--propose') {
      mode = 'propose';
      continue;
    }

    if (arg === '--allow-create-suppliers') {
      allowCreateSuppliers = true;
      continue;
    }

    if (arg === '--plan') {
      approvedPlanPath = takeValue(args, i, arg);
      i++;
      continue;
    }

    if (arg.startsWith('--plan=')) {
      approvedPlanPath = arg.slice('--plan='.length);
      continue;
    }

    if (arg.startsWith('--import-type=')) {
      const value = arg.slice('--import-type='.length);
      if (!isImportType(value)) {
        throw new Error(`Unknown import type: ${value}`);
      }
      importType = value;
      continue;
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

  if (mode === 'import' && !env.IMPORT_USER_ID) {
    throw new Error('IMPORT_USER_ID is required');
  }

  return {
    csvFilePath,
    importType,
    mode,
    tenantId,
    tenantName:
      env.IMPORT_TENANT_NAME ??
      (tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_NAME : tenantId),
    tenantSlug:
      env.IMPORT_TENANT_SLUG ??
      (tenantId === DEFAULT_TENANT_ID ? DEFAULT_TENANT_SLUG : tenantId),
    userId: env.IMPORT_USER_ID ?? SCRIPT_PREVIEW_USER_ID,
    approvedPlanPath,
    allowCreateSuppliers,
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

const databaseResource = Effect.acquireRelease(
  Effect.sync(createDatabase),
  ({ pool }) => Effect.promise(() => pool.end()),
);

const readTextFile = (path: string) =>
  Effect.try({
    try: () => fs.readFileSync(path, 'utf-8'),
    catch: (cause) => cause,
  });

const readApprovedPlan = (
  options: CliOptions,
): Effect.Effect<ProductImportApprovedPlanDto | undefined, unknown> => {
  if (!options.approvedPlanPath) return Effect.succeed(undefined);
  return readTextFile(options.approvedPlanPath).pipe(
    Effect.flatMap((content) =>
      Effect.try({
        try: () => JSON.parse(content) as ProductImportApprovedPlanDto,
        catch: (cause) => cause,
      }),
    ),
  );
};

const ensureCsvFileExists = (path: string) =>
  Effect.try({
    try: () => {
      if (!fs.existsSync(path)) {
        throw new Error(`File not found: ${path}`);
      }
    },
    catch: (cause) => cause,
  });

const makeProductImportServiceLayer = (db: DrizzleDb, options: CliOptions) =>
  ProductImportService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DrizzleDatabase, db),
        Layer.succeed(CurrentRequestContext, makeScriptRequestContext(options)),
      ),
    ),
  );

function printSummary(result: ProductImportResultDto) {
  console.log('\nImport completed.\n');
  console.log('Summary:');
  console.log(`  - Categories created: ${result.categoriesCreated}`);
  console.log(`  - Locations created: ${result.locationsCreated}`);
  console.log(`  - Areas created: ${result.areasCreated ?? 0}`);
  console.log(`  - Suppliers created: ${result.suppliersCreated ?? 0}`);
  console.log(`  - Products created: ${result.productsCreated}`);
  console.log(`  - Products updated: ${result.productsUpdated}`);
  console.log(
    `  - Inventory records created: ${result.inventoryRecordsCreated}`,
  );
  console.log(
    `  - Inventory records updated: ${result.inventoryRecordsUpdated}`,
  );
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

function printPreview(result: ProductImportPreviewDto) {
  console.log('\nImport preview completed.\n');
  console.log(`Format: ${result.format}`);
  console.log(`Rows: ${result.importableRows}/${result.totalRows} importable`);
  console.log(`Categories: ${result.categoryMappings.length}`);
  console.log(`Locations: ${result.locationMappings.length}`);
  console.log(`Supplier candidates: ${result.supplierMappings.length}`);
  console.log(
    `Duplicate SKU conflicts: ${result.duplicateSkuConflicts.length}`,
  );
  console.log(`Warnings: ${result.warnings.length}`);
  console.log(JSON.stringify(result, null, 2));
}

function printProposal(result: ProductImportAiProposalDto) {
  console.log('\nImport proposal completed.\n');
  console.log(JSON.stringify(result, null, 2));
}

function runImport(options: CliOptions) {
  return Effect.scoped(
    Effect.gen(function* () {
      const content = yield* readTextFile(options.csvFilePath);
      const approvedPlan = yield* readApprovedPlan(options);
      const { db } = yield* databaseResource;
      const serviceLayer = makeProductImportServiceLayer(db, options);

      return yield* Effect.flatMap(ProductImportService, (service) =>
        service.importFromCsvContent({
          content,
          importType: options.importType,
          userId: options.userId,
          approvedPlan,
          allowCreateSuppliers:
            options.allowCreateSuppliers ||
            approvedPlan?.allowCreateSuppliers === true,
        }),
      ).pipe(Effect.provide(serviceLayer));
    }),
  );
}

function runPreview(options: CliOptions) {
  return Effect.scoped(
    Effect.gen(function* () {
      const content = yield* readTextFile(options.csvFilePath);
      const { db } = yield* databaseResource;
      const serviceLayer = makeProductImportServiceLayer(db, options);

      return yield* Effect.flatMap(ProductImportService, (service) =>
        service.previewCsvContent({
          content,
          importType: options.importType,
        }),
      ).pipe(Effect.provide(serviceLayer));
    }),
  );
}

function runPropose(options: CliOptions) {
  return Effect.scoped(
    Effect.gen(function* () {
      const content = yield* readTextFile(options.csvFilePath);
      const { db } = yield* databaseResource;
      const serviceLayer = makeProductImportServiceLayer(db, options);

      return yield* Effect.flatMap(ProductImportService, (service) =>
        service.proposeImportPlan({
          content,
          importType: options.importType,
        }),
      ).pipe(Effect.provide(serviceLayer));
    }),
  );
}

const main = Effect.gen(function* () {
  const options = yield* Effect.try({
    try: () => readOptions(process.argv.slice(2), process.env),
    catch: (cause) => cause,
  });
  yield* ensureCsvFileExists(options.csvFilePath);

  yield* Effect.sync(() =>
    console.log(
      `Starting product import ${options.mode} (${options.importType}) for tenant ${options.tenantId}`,
    ),
  );

  if (options.mode === 'preview') {
    const result = yield* runPreview(options);
    yield* Effect.sync(() => printPreview(result));
    return;
  }

  if (options.mode === 'propose') {
    const result = yield* runPropose(options);
    yield* Effect.sync(() => printProposal(result));
    return;
  }

  const result = yield* runImport(options);
  yield* Effect.sync(() => printSummary(result));
});

Effect.runPromise(main).catch((error: unknown) => {
  console.error(
    `\nImport failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  usage();
  process.exit(1);
});
