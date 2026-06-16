import { Effect } from 'effect';
import { eq, or, ilike, sql, type SQL } from 'drizzle-orm';
import type { ClientQueryDto } from '@stocket/types/clients';
import { makeTenantCrud } from '../../platform/db/tenant-crud';
import { clients } from '../../platform/db/schema';
import { TenantQuery } from '../../platform/tenancy/tenant-query';
import { ClientsInfrastructureError } from './clients.errors';

function buildClientFilters(query: ClientQueryDto): SQL[] {
  const conditions: SQL[] = [];
  if (query.q) {
    conditions.push(
      or(
        ilike(clients.company_name, `%${query.q}%`),
        ilike(clients.email, `%${query.q}%`),
      )!,
    );
  }
  if (query.account_status) {
    conditions.push(eq(clients.account_status, query.account_status));
  }
  return conditions;
}

export class ClientsRepository extends Effect.Service<ClientsRepository>()(
  '@stocket/effect/clients/ClientsRepository',
  {
    effect: makeTenantCrud(clients, {
      entity: 'client',
      onError: (action, cause) =>
        new ClientsInfrastructureError({
          action,
          cause,
          messageKey: 'clients.repositoryFailed',
        }),
      list: {
        filters: buildClientFilters,
        orderBy: sql`"company_name" ASC`,
      },
      extras: ({ db, tryAsync, scopedWhere }) => ({
        findByEmail: (email: string) =>
          Effect.gen(function* () {
            const where = yield* scopedWhere(eq(clients.email, email));
            return yield* tryAsync('load client by email', async () => {
              const rows = await db
                .select()
                .from(clients)
                .where(where)
                .limit(1);
              return rows[0] ?? null;
            });
          }),
      }),
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
