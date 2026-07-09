import { Effect } from 'effect';
import { and, eq, inArray, type AnyColumn, type SQL } from 'drizzle-orm';
import { requireRequestTenantId } from './tenant-context';

export interface TenantScopedTable {
  readonly tenant_id: AnyColumn;
}

export interface IdentifiedTenantScopedTable extends TenantScopedTable {
  readonly id: AnyColumn;
}

export type TenantInsertValues<T extends object> = Omit<T, 'tenant_id'> & {
  readonly tenant_id: string;
};

export interface TenantScope {
  readonly tenantId: string;
  readonly tenantPredicate: (table: TenantScopedTable) => SQL;
  readonly whereTenant: (table: TenantScopedTable, ...conditions: SQL[]) => SQL;
  readonly whereTenantId: (
    table: IdentifiedTenantScopedTable,
    id: string,
    ...conditions: SQL[]
  ) => SQL;
  readonly whereTenantIds: (
    table: IdentifiedTenantScopedTable,
    ids: readonly string[],
    ...conditions: SQL[]
  ) => SQL;
  readonly insertValues: <T extends object>(data: T) => TenantInsertValues<T>;
}

const combineConditions = (
  tenantCondition: SQL,
  conditions: readonly SQL[],
): SQL =>
  conditions.length === 0
    ? tenantCondition
    : and(tenantCondition, ...conditions)!;

const makeTenantScope = (tenantId: string): TenantScope => ({
  tenantId,

  tenantPredicate: (table) => eq(table.tenant_id, tenantId),

  whereTenant: (table, ...conditions) =>
    combineConditions(eq(table.tenant_id, tenantId), conditions),

  whereTenantId: (table, id, ...conditions) =>
    combineConditions(
      and(eq(table.tenant_id, tenantId), eq(table.id, id))!,
      conditions,
    ),

  whereTenantIds: (table, ids, ...conditions) =>
    combineConditions(
      and(eq(table.tenant_id, tenantId), inArray(table.id, ids))!,
      conditions,
    ),

  insertValues: <T extends object>(data: T): TenantInsertValues<T> => ({
    ...data,
    tenant_id: tenantId,
  }),
});

export class TenantQuery extends Effect.Service<TenantQuery>()(
  '@stocket/effect/platform/TenantQuery',
  {
    effect: Effect.succeed({
      forTenant: makeTenantScope,

      tenantId: requireRequestTenantId,

      tenantPredicate: (table: TenantScopedTable) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          makeTenantScope(tenantId).tenantPredicate(table),
        ),

      whereTenant: (table: TenantScopedTable, ...conditions: SQL[]) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          makeTenantScope(tenantId).whereTenant(table, ...conditions),
        ),

      whereTenantId: (
        table: IdentifiedTenantScopedTable,
        id: string,
        ...conditions: SQL[]
      ) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          makeTenantScope(tenantId).whereTenantId(table, id, ...conditions),
        ),

      whereTenantIds: (
        table: IdentifiedTenantScopedTable,
        ids: readonly string[],
        ...conditions: SQL[]
      ) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          makeTenantScope(tenantId).whereTenantIds(table, ids, ...conditions),
        ),

      insertValues: <T extends object>(data: T) =>
        Effect.map(
          requireRequestTenantId,
          (tenantId): TenantInsertValues<T> =>
            makeTenantScope(tenantId).insertValues(data),
        ),
    }),
  },
) {}
