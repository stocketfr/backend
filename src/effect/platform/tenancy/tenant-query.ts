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

const combineConditions = (
  tenantCondition: SQL,
  conditions: readonly SQL[],
): SQL =>
  conditions.length === 0
    ? tenantCondition
    : and(tenantCondition, ...conditions)!;

export class TenantQuery extends Effect.Service<TenantQuery>()(
  '@stocket/effect/platform/TenantQuery',
  {
    effect: Effect.succeed({
      tenantId: requireRequestTenantId,

      tenantPredicate: (table: TenantScopedTable) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          eq(table.tenant_id, tenantId),
        ),

      whereTenant: (table: TenantScopedTable, ...conditions: SQL[]) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          combineConditions(eq(table.tenant_id, tenantId), conditions),
        ),

      whereTenantId: (
        table: IdentifiedTenantScopedTable,
        id: string,
        ...conditions: SQL[]
      ) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          combineConditions(
            and(eq(table.tenant_id, tenantId), eq(table.id, id))!,
            conditions,
          ),
        ),

      whereTenantIds: (
        table: IdentifiedTenantScopedTable,
        ids: readonly string[],
        ...conditions: SQL[]
      ) =>
        Effect.map(requireRequestTenantId, (tenantId) =>
          combineConditions(
            and(eq(table.tenant_id, tenantId), inArray(table.id, ids))!,
            conditions,
          ),
        ),

      insertValues: <T extends object>(data: T) =>
        Effect.map(
          requireRequestTenantId,
          (tenantId): TenantInsertValues<T> => ({
            ...data,
            tenant_id: tenantId,
          }),
        ),
    }),
  },
) {}
