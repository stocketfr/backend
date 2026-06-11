import { Effect } from 'effect';
import { eq, ilike, sql, type SQL } from 'drizzle-orm';
import type { LocationQueryDto } from '@stocket/types/locations';
import { LocationSortField } from '@stocket/types/locations';
import type { SortOrder } from '@stocket/types/common';
import { buildOrderBy } from '../../platform/drizzle-sort.utils';
import { makeTenantCrud } from '../../platform/tenant-crud';
import { locations } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenant-query';
import { LocationsInfrastructureError } from './locations.errors';

function buildLocationFilters(query: LocationQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (query.search) {
    conditions.push(ilike(locations.name, `%${query.search}%`));
  }
  if (query.type) {
    conditions.push(eq(locations.type, query.type));
  }
  if (query.is_active !== undefined) {
    conditions.push(eq(locations.is_active, query.is_active));
  }
  return conditions;
}

const locationSortColumns = {
  [LocationSortField.NAME]: locations.name,
  [LocationSortField.TYPE]: locations.type,
  [LocationSortField.CREATED_AT]: locations.created_at,
  [LocationSortField.UPDATED_AT]: locations.updated_at,
} as const;

function getLocationOrderBy(sortBy?: LocationSortField, sortOrder?: SortOrder) {
  return buildOrderBy(
    locationSortColumns,
    sortBy ?? LocationSortField.NAME,
    (sortOrder ?? 'ASC') as 'ASC' | 'DESC',
  );
}

export class LocationsRepository extends Effect.Service<LocationsRepository>()(
  '@stocket/effect/locations/LocationsRepository',
  {
    effect: makeTenantCrud(locations, {
      entity: 'location',
      onError: (action, cause) =>
        new LocationsInfrastructureError({
          action,
          cause,
          messageKey: 'locations.repositoryFailed',
        }),
      list: {
        filters: buildLocationFilters,
        orderBy: (query) => getLocationOrderBy(query.sort_by, query.sort_order),
      },
      extras: ({ db, tryAsync, scopedWhere }) => ({
        findAll: () =>
          Effect.gen(function* () {
            const where = yield* scopedWhere();
            return yield* tryAsync('list all locations', () =>
              db
                .select()
                .from(locations)
                .where(where)
                .orderBy(sql`"name" ASC`),
            );
          }),
      }),
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
