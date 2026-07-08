import { Effect } from 'effect';
import { isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
  type RepositoryPaginatedResult,
} from '@stocket/types/common';
import { DrizzleDatabase, type DrizzleDb } from './drizzle';
import { withDrizzleTransaction } from './transaction';
import {
  TenantQuery,
  type TenantInsertValues,
  type TenantScope,
} from '../tenancy/tenant-query';
import type { TenantNotResolved } from '../tenancy/tenant-context';
import { makeTryAsync } from '../effect/try-async';
import { pgUniqueViolationConstraintName } from './pg-errors';

/**
 * Tables the factory can serve: a Drizzle table whose schema includes the
 * three standard tenant-scoped columns. `PgColumn` is assignable to the
 * `AnyColumn` that `TenantQuery` expects, so any `TenantCrudTable` works with
 * `whereTenant` / `whereTenantId` directly.
 */
export type TenantCrudTable = PgTable & {
  readonly id: PgColumn;
  readonly tenant_id: PgColumn;
  readonly updated_at: PgColumn;
};

export type TenantCrudRow<TTable extends TenantCrudTable> =
  TTable['$inferSelect'];

/** `tenant_id` is excluded: the factory always stamps the request tenant. */
export type TenantCrudCreateInput<TTable extends TenantCrudTable> = Omit<
  TTable['$inferInsert'],
  'tenant_id'
>;

/**
 * Update patches may not name immutable columns. The implementation also
 * strips them at runtime and stamps `updated_at` itself.
 */
export type TenantCrudUpdatePatch<TTable extends TenantCrudTable> = Omit<
  Partial<TTable['$inferInsert']>,
  'id' | 'tenant_id' | 'created_at' | 'updated_at'
>;

/**
 * Singular entity name, or both forms when the plural is irregular.
 * Drives the action strings on infrastructure errors:
 *
 *   findAllPaginated → `list ${plural}`
 *   findById         → `load ${singular}`
 *   existsById       → `check ${singular} existence`
 *   create           → `create ${singular}`
 *   update           → `update ${singular}`
 *   delete           → `delete ${singular}`
 */
export type TenantCrudEntity =
  | string
  | { readonly singular: string; readonly plural: string };

/** Minimal query shape `findAllPaginated` needs; every `XQueryDto` has it. */
export interface TenantCrudPaginatedQuery {
  readonly page?: number;
  readonly limit?: number;
}

export interface TenantCrudListSpec<
  TQuery extends TenantCrudPaginatedQuery,
> {
  /** Per-module WHERE fragments, ANDed onto the tenant predicate. */
  readonly filters: (query: TQuery) => SQL[];
  /**
   * Sole source of ORDER BY — either a fixed fragment or derived per request
   * (e.g. via `buildOrderBy` and a sort-column map). No implicit tiebreaker.
   */
  readonly orderBy: SQL | ((query: TQuery) => SQL);
  /**
   * Soft-delete repositories exclude deleted rows by default. Provide this
   * when a query DTO can explicitly request deleted rows.
   */
  readonly includeDeleted?: (query: TQuery) => boolean;
}

export interface TenantCrudReadOptions {
  readonly includeDeleted?: boolean;
}

export interface TenantCrudSoftDeleteSpec {
  readonly deletedAt: PgColumn;
  readonly deletedBy?: PgColumn;
}

export type TenantCrudUniqueViolations<E> = Partial<
  Record<string, (cause: unknown) => E>
>;

/**
 * Primitives handed to `extras` so bespoke methods ride the same tenant
 * fence and error wrapping as the generated ones. There is no way to obtain
 * a non-tenant-scoped WHERE from these.
 */
export interface TenantCrudTools<E> {
  readonly db: DrizzleDb;
  /** Module-scoped tryAsync — failures map through `onError`. */
  readonly tryAsync: <A>(
    action: string,
    run: () => Promise<A>,
  ) => Effect.Effect<A, E>;
  /** tenant_id = current tenant AND ...conditions */
  readonly scopedWhere: (
    ...conditions: SQL[]
  ) => Effect.Effect<SQL, TenantNotResolved>;
  /** tenant_id = current tenant AND id = ? AND ...conditions */
  readonly scopedWhereId: (
    id: string,
    ...conditions: SQL[]
  ) => Effect.Effect<SQL, TenantNotResolved>;
  /** tenant_id = current tenant AND id IN (...) AND ...conditions */
  readonly scopedWhereIds: (
    ids: readonly string[],
    ...conditions: SQL[]
  ) => Effect.Effect<SQL, TenantNotResolved>;
  /** Current tenant id from request context. */
  readonly tenantId: Effect.Effect<string, TenantNotResolved>;
  /** Current tenant as a reusable predicate/insert helper scope. */
  readonly tenantScope: Effect.Effect<TenantScope, TenantNotResolved>;
  /** Stamp arbitrary insert values with the current tenant id. */
  readonly insertValues: <T extends object>(
    values: T,
  ) => Effect.Effect<TenantInsertValues<T>, TenantNotResolved>;
  /** Module-scoped transaction wrapper — failures map through `onError`. */
  readonly withTransaction: <A>(
    action: string,
    run: (tx: DrizzleDb) => Promise<A>,
  ) => Effect.Effect<A, E>;
}

type TenantCrudCoreKey =
  | TenantCrudReadKey
  | TenantCrudWriteKey
  | TenantCrudSoftDeleteKey;

type TenantCrudReadKey =
  | 'findAllPaginated'
  | 'findById'
  | 'findByIds'
  | 'existsById';

type TenantCrudWriteKey =
  | 'create'
  | 'update'
  | 'updateMany'
  | 'delete';

type TenantCrudSoftDeleteKey =
  | 'softDelete'
  | 'softDeleteMany'
  | 'restore'
  | 'restoreMany'
  | 'findDeletedByIds'
  | 'hardDelete'
  | 'hardDeleteMany';

type TenantCrudNoReadsForbiddenKey =
  | TenantCrudWriteKey
  | TenantCrudSoftDeleteKey;

/** Extras may extend the record but never shadow a generated method. */
export type TenantCrudExtensionGuard<
  Extras,
  ForbiddenKey extends PropertyKey = TenantCrudCoreKey,
> = {
  readonly [K in keyof Extras]: K extends ForbiddenKey
    ? never
    : Extras[K];
};

export interface TenantCrudConfig<
  E,
  Extras extends object,
  ForbiddenKey extends PropertyKey = TenantCrudCoreKey,
> {
  readonly entity: TenantCrudEntity;
  /**
   * Maps every infrastructure failure to the module's own error class,
   * keeping the hand-typed messageKey in module code (structured-logging
   * invariant). Same contract as `makeTryAsync`.
   */
  readonly onError: (action: string, cause: unknown) => E;
  readonly softDelete?: TenantCrudSoftDeleteSpec;
  readonly uniqueViolations?: TenantCrudUniqueViolations<E>;
  /**
   * Set to false when a module supplies every read method itself, usually
   * because reads must always join related tables.
   */
  readonly reads?: boolean;
  /** Bespoke methods, merged into the returned record. */
  readonly extras?: (
    tools: TenantCrudTools<E>,
  ) => Extras & TenantCrudExtensionGuard<Extras, ForbiddenKey>;
}

export interface TenantCrudReads<TTable extends TenantCrudTable, E> {
  /** Row within the current tenant, or null — cross-tenant ids look missing. */
  readonly findById: (
    id: string,
    options?: TenantCrudReadOptions,
  ) => Effect.Effect<TenantCrudRow<TTable> | null, E | TenantNotResolved>;

  readonly findByIds: (
    ids: readonly string[],
    options?: TenantCrudReadOptions,
  ) => Effect.Effect<TenantCrudRow<TTable>[], E | TenantNotResolved>;

  readonly existsById: (
    id: string,
    options?: TenantCrudReadOptions,
  ) => Effect.Effect<boolean, E | TenantNotResolved>;
}

export interface TenantCrudWrites<TTable extends TenantCrudTable, E> {
  /** INSERT … RETURNING; `tenant_id` always stamped from request context. */
  readonly create: (
    data: TenantCrudCreateInput<TTable>,
  ) => Effect.Effect<TenantCrudRow<TTable>, E | TenantNotResolved>;

  /**
   * Single UPDATE … RETURNING. Returns the full updated row, or null when no
   * row matched within the tenant. Immutable columns are stripped at runtime;
   * `updated_at` is always stamped. An empty patch is valid and bumps
   * `updated_at`.
   */
  readonly update: (
    id: string,
    data: TenantCrudUpdatePatch<TTable>,
  ) => Effect.Effect<TenantCrudRow<TTable> | null, E | TenantNotResolved>;

  readonly updateMany: (
    ids: readonly string[],
    data: TenantCrudUpdatePatch<TTable>,
  ) => Effect.Effect<string[], E | TenantNotResolved>;

  /** Idempotent; deleting a missing or cross-tenant id is a silent no-op. */
  readonly delete: (id: string) => Effect.Effect<void, E | TenantNotResolved>;
}

export interface TenantCrud<TTable extends TenantCrudTable, E>
  extends TenantCrudReads<TTable, E>,
    TenantCrudWrites<TTable, E> {}

export interface TenantCrudWithSoftDelete<
  TTable extends TenantCrudTable,
  E,
> {
  readonly findDeletedByIds: (
    ids: readonly string[],
  ) => Effect.Effect<TenantCrudRow<TTable>[], E | TenantNotResolved>;

  readonly softDelete: (
    id: string,
    deletedBy?: string | null,
  ) => Effect.Effect<void, E | TenantNotResolved>;

  readonly softDeleteMany: (
    ids: readonly string[],
    deletedBy?: string | null,
  ) => Effect.Effect<string[], E | TenantNotResolved>;

  readonly restore: (id: string) => Effect.Effect<void, E | TenantNotResolved>;

  readonly restoreMany: (
    ids: readonly string[],
  ) => Effect.Effect<string[], E | TenantNotResolved>;

  readonly hardDelete: (
    id: string,
  ) => Effect.Effect<void, E | TenantNotResolved>;

  readonly hardDeleteMany: (
    ids: readonly string[],
  ) => Effect.Effect<string[], E | TenantNotResolved>;
}

export interface TenantCrudWithList<
  TTable extends TenantCrudTable,
  E,
  TQuery extends TenantCrudPaginatedQuery,
> extends TenantCrud<TTable, E> {
  /**
   * Count + data queries under one tenant+filter predicate, run
   * concurrently (not a transactional snapshot). Window defaults: page 1,
   * limit 20. A page beyond the last returns empty data with correct totals.
   */
  readonly findAllPaginated: (
    query: TQuery,
  ) => Effect.Effect<
    RepositoryPaginatedResult<TenantCrudRow<TTable>>,
    E | TenantNotResolved
  >;
}

const IMMUTABLE_COLUMNS = new Set(['id', 'tenant_id', 'created_at', 'updated_at']);

const resolveEntity = (entity: TenantCrudEntity) =>
  typeof entity === 'string'
    ? {
        singular: entity,
        plural: entity.endsWith('y')
          ? `${entity.slice(0, -1)}ies`
          : `${entity}s`,
      }
    : entity;

/**
 * Builds the standard tenant-scoped CRUD method set for a table. Consumed
 * inside an `Effect.Service` `effect:` block; `dependencies:
 * [TenantQuery.Default]` discharges `TenantQuery`, while `DrizzleDatabase`
 * stays in the layer requirements and is provided once by `platformLayer`.
 *
 * `findAllPaginated` exists on the result exactly when `list` is configured.
 * Tenant resolution happens per call (never captured at construction), so a
 * single service instance serves every tenant and fails with
 * `TenantNotResolved` before touching the database.
 */
export function makeTenantCrud<
  TTable extends TenantCrudTable,
  E,
  TQuery extends TenantCrudPaginatedQuery,
  Extras extends object = Record<never, never>,
>(
  table: TTable,
  config: TenantCrudConfig<E, Extras, TenantCrudNoReadsForbiddenKey> & {
    readonly reads: false;
    readonly list?: TenantCrudListSpec<TQuery>;
    readonly softDelete: TenantCrudSoftDeleteSpec;
  },
): Effect.Effect<
  TenantCrudWrites<TTable, E> & TenantCrudWithSoftDelete<TTable, E> & Extras,
  never,
  DrizzleDb | TenantQuery
>;
export function makeTenantCrud<
  TTable extends TenantCrudTable,
  E,
  TQuery extends TenantCrudPaginatedQuery,
  Extras extends object = Record<never, never>,
>(
  table: TTable,
  config: TenantCrudConfig<E, Extras, TenantCrudNoReadsForbiddenKey> & {
    readonly reads: false;
    readonly list?: TenantCrudListSpec<TQuery>;
    readonly softDelete?: undefined;
  },
): Effect.Effect<
  TenantCrudWrites<TTable, E> & Extras,
  never,
  DrizzleDb | TenantQuery
>;
export function makeTenantCrud<
  TTable extends TenantCrudTable,
  E,
  TQuery extends TenantCrudPaginatedQuery,
  Extras extends object = Record<never, never>,
>(
  table: TTable,
  config: TenantCrudConfig<E, Extras> & {
    readonly reads?: true;
    readonly list: TenantCrudListSpec<TQuery>;
    readonly softDelete: TenantCrudSoftDeleteSpec;
  },
): Effect.Effect<
  TenantCrudWithList<TTable, E, TQuery> &
    TenantCrudWithSoftDelete<TTable, E> &
    Extras,
  never,
  DrizzleDb | TenantQuery
>;
export function makeTenantCrud<
  TTable extends TenantCrudTable,
  E,
  Extras extends object = Record<never, never>,
>(
  table: TTable,
  config: TenantCrudConfig<E, Extras> & {
    readonly reads?: true;
    readonly list?: undefined;
    readonly softDelete: TenantCrudSoftDeleteSpec;
  },
): Effect.Effect<
  TenantCrud<TTable, E> & TenantCrudWithSoftDelete<TTable, E> & Extras,
  never,
  DrizzleDb | TenantQuery
>;
export function makeTenantCrud<
  TTable extends TenantCrudTable,
  E,
  TQuery extends TenantCrudPaginatedQuery,
  Extras extends object = Record<never, never>,
>(
  table: TTable,
  config: TenantCrudConfig<E, Extras> & {
    readonly reads?: true;
    readonly list: TenantCrudListSpec<TQuery>;
    readonly softDelete?: undefined;
  },
): Effect.Effect<
  TenantCrudWithList<TTable, E, TQuery> & Extras,
  never,
  DrizzleDb | TenantQuery
>;
export function makeTenantCrud<
  TTable extends TenantCrudTable,
  E,
  Extras extends object = Record<never, never>,
>(
  table: TTable,
  config: TenantCrudConfig<E, Extras> & {
    readonly reads?: true;
    readonly list?: undefined;
  },
): Effect.Effect<
  TenantCrud<TTable, E> & Extras,
  never,
  DrizzleDb | TenantQuery
>;
export function makeTenantCrud<
  TTable extends TenantCrudTable,
  E,
  TQuery extends TenantCrudPaginatedQuery,
  Extras extends object = Record<never, never>,
>(
  table: TTable,
  config: TenantCrudConfig<E, Extras> & {
    readonly reads?: boolean;
    readonly list?: TenantCrudListSpec<TQuery>;
  },
): Effect.Effect<
  TenantCrudWrites<TTable, E> &
    Partial<TenantCrudReads<TTable, E>> &
    Partial<TenantCrudWithList<TTable, E, TQuery>> &
    Partial<TenantCrudWithSoftDelete<TTable, E>> &
    Extras,
  never,
  DrizzleDb | TenantQuery
> {
  return Effect.gen(function* () {
    const db = yield* DrizzleDatabase;
    const tenantQuery = yield* TenantQuery;

    const { singular, plural } = resolveEntity(config.entity);
    const mapInfrastructureError = (action: string, cause: unknown): E => {
      const constraint = pgUniqueViolationConstraintName(cause);
      const mapped =
        constraint === null
          ? undefined
          : config.uniqueViolations?.[constraint]?.(cause);
      return mapped ?? config.onError(action, cause);
    };
    const tryAsync = makeTryAsync(mapInfrastructureError);

    const scopedWhere = (...conditions: SQL[]) =>
      tenantQuery.whereTenant(table, ...conditions);
    const scopedWhereId = (id: string, ...conditions: SQL[]) =>
      tenantQuery.whereTenantId(table, id, ...conditions);
    const scopedWhereIds = (ids: readonly string[], ...conditions: SQL[]) =>
      tenantQuery.whereTenantIds(table, [...ids], ...conditions);
    const tenantScope = Effect.map(tenantQuery.tenantId, (id) =>
      tenantQuery.forTenant(id),
    );
    const insertValues = <T extends object>(values: T) =>
      tenantQuery.insertValues(values);
    const withTransaction = <A>(
      action: string,
      run: (tx: DrizzleDb) => Promise<A>,
    ) => tryAsync(action, () => withDrizzleTransaction(db, run));

    // Drizzle's query-builder types only reduce for concrete tables; for a
    // generic TTable they cannot be proven equal to `$inferSelect` /
    // `$inferInsert`, and `from()`'s empty-selection guard is a conditional
    // type that never reduces over an unresolved generic. These bridges
    // (plus the assembly cast at the bottom) are the only casts behind the
    // factory's cast-free public interface.
    const fromTable = table as PgTable;
    const asRows = (rows: unknown) => rows as Array<TenantCrudRow<TTable>>;
    const asInsertValues = (values: object) =>
      values as TTable['$inferInsert'];
    const asUpdateSet = (values: Record<string, unknown>) =>
      values as PgUpdateSetSource<TTable>;
    const softDelete = config.softDelete;
    const activeConditions = (options?: TenantCrudReadOptions): SQL[] =>
      softDelete === undefined || options?.includeDeleted === true
        ? []
        : [isNull(softDelete.deletedAt)];
    const deletedConditions = (): SQL[] =>
      softDelete === undefined ? [] : [isNotNull(softDelete.deletedAt)];

    const findById = (id: string, options?: TenantCrudReadOptions) =>
      Effect.gen(function* () {
        const where = yield* scopedWhereId(id, ...activeConditions(options));
        return yield* tryAsync(`load ${singular}`, async () => {
          const rows = await db.select().from(fromTable).where(where).limit(1);
          return asRows(rows)[0] ?? null;
        });
      });

    const findByIds = (ids: readonly string[], options?: TenantCrudReadOptions) =>
      Effect.gen(function* () {
        if (ids.length === 0) return [];
        const where = yield* scopedWhereIds(ids, ...activeConditions(options));
        return yield* tryAsync(`find ${plural} by ids`, async () =>
          asRows(await db.select().from(fromTable).where(where)),
        );
      });

    const existsById = (id: string, options?: TenantCrudReadOptions) =>
      Effect.gen(function* () {
        const where = yield* scopedWhereId(id, ...activeConditions(options));
        return yield* tryAsync(`check ${singular} existence`, async () => {
          const rows = await db
            .select({ id: table.id })
            .from(fromTable)
            .where(where)
            .limit(1);
          return rows.length > 0;
        });
      });

    const create = (data: TenantCrudCreateInput<TTable>) =>
      Effect.gen(function* () {
        const values = yield* tenantQuery.insertValues(data);
        return yield* tryAsync(`create ${singular}`, async () => {
          const rows = await db
            .insert(table)
            .values(asInsertValues(values))
            .returning();
          const row = asRows(rows)[0];
          if (!row) {
            throw new Error(`insert returned no row for ${singular}`);
          }
          return row;
        });
      });

    const update = (id: string, data: TenantCrudUpdatePatch<TTable>) =>
      Effect.gen(function* () {
        const where = yield* scopedWhereId(id, ...activeConditions());
        return yield* tryAsync(`update ${singular}`, async () => {
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data)) {
            if (!IMMUTABLE_COLUMNS.has(key)) {
              patch[key] = value;
            }
          }
          const rows = await db
            .update(table)
            .set(asUpdateSet({ ...patch, updated_at: new Date() }))
            .where(where)
            .returning();
          return asRows(rows)[0] ?? null;
        });
      });

    const updateMany = (
      ids: readonly string[],
      data: TenantCrudUpdatePatch<TTable>,
    ) =>
      Effect.gen(function* () {
        if (ids.length === 0) return [];
        const where = yield* scopedWhereIds(ids, ...activeConditions());
        return yield* tryAsync(`update multiple ${plural}`, async () => {
          const patch: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(data)) {
            if (!IMMUTABLE_COLUMNS.has(key)) {
              patch[key] = value;
            }
          }
          const rows = await db
            .update(table)
            .set(asUpdateSet({ ...patch, updated_at: new Date() }))
            .where(where)
            .returning({ id: table.id });
          return rows.map((row) => String(row.id));
        });
      });

    const remove = (id: string) =>
      Effect.gen(function* () {
        const where = yield* scopedWhereId(id);
        return yield* tryAsync(`delete ${singular}`, async () => {
          await db.delete(table).where(where);
        });
      });

    const makeSoftDeleteMethods = () => {
      if (softDelete === undefined) return {};

      const deletedAtName = softDelete.deletedAt.name;
      const deletedByName = softDelete.deletedBy?.name;

      const softDeleteSet = (deletedBy?: string | null) => ({
        [deletedAtName]: new Date(),
        ...(deletedByName === undefined
          ? {}
          : { [deletedByName]: deletedBy ?? null }),
        updated_at: new Date(),
      });

      const restoreSet = {
        [deletedAtName]: null,
        ...(deletedByName === undefined ? {} : { [deletedByName]: null }),
        updated_at: new Date(),
      };

      const findDeletedByIds = (ids: readonly string[]) =>
        Effect.gen(function* () {
          if (ids.length === 0) return [];
          const where = yield* scopedWhereIds(ids, ...deletedConditions());
          return yield* tryAsync(`find deleted ${plural} by ids`, async () =>
            asRows(await db.select().from(fromTable).where(where)),
          );
        });

      const softDeleteOne = (id: string, deletedBy?: string | null) =>
        Effect.gen(function* () {
          const where = yield* scopedWhereId(id, ...activeConditions());
          return yield* tryAsync(`soft delete ${singular}`, async () => {
            await db
              .update(table)
              .set(asUpdateSet(softDeleteSet(deletedBy)))
              .where(where);
          });
        });

      const softDeleteMany = (
        ids: readonly string[],
        deletedBy?: string | null,
      ) =>
        Effect.gen(function* () {
          if (ids.length === 0) return [];
          const where = yield* scopedWhereIds(ids, ...activeConditions());
          return yield* tryAsync(`soft delete multiple ${plural}`, async () => {
            const rows = await db
              .update(table)
              .set(asUpdateSet(softDeleteSet(deletedBy)))
              .where(where)
              .returning({ id: table.id });
            return rows.map((row) => String(row.id));
          });
        });

      const restore = (id: string) =>
        Effect.gen(function* () {
          const where = yield* scopedWhereId(id, ...deletedConditions());
          return yield* tryAsync(`restore ${singular}`, async () => {
            await db.update(table).set(asUpdateSet(restoreSet)).where(where);
          });
        });

      const restoreMany = (ids: readonly string[]) =>
        Effect.gen(function* () {
          if (ids.length === 0) return [];
          const where = yield* scopedWhereIds(ids, ...deletedConditions());
          return yield* tryAsync(`restore multiple ${plural}`, async () => {
            const rows = await db
              .update(table)
              .set(asUpdateSet(restoreSet))
              .where(where)
              .returning({ id: table.id });
            return rows.map((row) => String(row.id));
          });
        });

      const hardDelete = (id: string) =>
        Effect.gen(function* () {
          const where = yield* scopedWhereId(id);
          return yield* tryAsync(`hard delete ${singular}`, async () => {
            await db.delete(table).where(where);
          });
        });

      const hardDeleteMany = (ids: readonly string[]) =>
        Effect.gen(function* () {
          if (ids.length === 0) return [];
          const where = yield* scopedWhereIds(ids);
          return yield* tryAsync(`hard delete multiple ${plural}`, async () => {
            const rows = await db
              .delete(table)
              .where(where)
              .returning({ id: table.id });
            return rows.map((row) => String(row.id));
          });
        });

      return {
        findDeletedByIds,
        softDelete: softDeleteOne,
        softDeleteMany,
        restore,
        restoreMany,
        hardDelete,
        hardDeleteMany,
      } satisfies TenantCrudWithSoftDelete<TTable, E>;
    };

    const readsEnabled = config.reads !== false;
    const list = readsEnabled ? config.list : undefined;
    const findAllPaginated =
      list === undefined
        ? undefined
        : (query: TQuery) =>
            Effect.gen(function* () {
              const where = yield* scopedWhere(
                ...activeConditions({
                  includeDeleted: list.includeDeleted?.(query) ?? false,
                }),
                ...list.filters(query),
              );
              return yield* tryAsync(`list ${plural}`, async () => {
                const { page, limit, skip } = resolvePaginationWindow(
                  query.page,
                  query.limit,
                );
                const orderBy =
                  typeof list.orderBy === 'function'
                    ? list.orderBy(query)
                    : list.orderBy;

                const [countResult, data] = await Promise.all([
                  db
                    .select({ count: sql<number>`count(*)::int` })
                    .from(fromTable)
                    .where(where),
                  db
                    .select()
                    .from(fromTable)
                    .where(where)
                    .orderBy(orderBy)
                    .offset(skip)
                    .limit(limit),
                ]);

                const total = countResult[0]?.count ?? 0;
                return toRepositoryPaginatedResult(
                  asRows(data),
                  total,
                  page,
                  limit,
                );
              });
            });

    const readMethods = readsEnabled
      ? {
          findById,
          findByIds,
          existsById,
          ...(findAllPaginated === undefined ? {} : { findAllPaginated }),
        }
      : {};

    const extras = config.extras?.({
      db,
      tryAsync,
      scopedWhere,
      scopedWhereId,
      scopedWhereIds,
      tenantId: tenantQuery.tenantId,
      tenantScope,
      insertValues,
      withTransaction,
    });

    return {
      create,
      update,
      updateMany,
      delete: remove,
      ...readMethods,
      ...makeSoftDeleteMethods(),
      ...extras,
    } as TenantCrudWrites<TTable, E> &
      Partial<TenantCrudReads<TTable, E>> &
      Partial<TenantCrudWithList<TTable, E, TQuery>> &
      Partial<TenantCrudWithSoftDelete<TTable, E>> &
      Extras;
  });
}
