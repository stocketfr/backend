import { Effect } from 'effect';
import { eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { SupplierQueryDto } from '@stocket/types/suppliers';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { suppliers } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { SuppliersInfrastructureError } from './suppliers.errors';

function buildSupplierFilters(query: SupplierQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (query.q) {
    conditions.push(ilike(suppliers.name, `%${query.q}%`));
  }
  if (query.is_active !== undefined) {
    conditions.push(eq(suppliers.is_active, query.is_active));
  }
  return conditions;
}

export class SuppliersRepository extends Effect.Service<SuppliersRepository>()(
  '@stocket/effect/suppliers/SuppliersRepository',
  {
    effect: makeTenantCrud(suppliers, {
      entity: 'supplier',
      onError: (action, cause) =>
        new SuppliersInfrastructureError({
          action,
          cause,
          messageKey: 'suppliers.repositoryFailed',
        }),
      list: {
        filters: buildSupplierFilters,
        orderBy: sql`"name" ASC`,
      },
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
