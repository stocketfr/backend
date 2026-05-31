import { Effect } from 'effect';
import {
  eq,
  and,
  desc,
  gte,
  lte,
  sql,
  getTableColumns,
  type SQL,
} from 'drizzle-orm';
import type {
  AuditAction,
  AuditEntityType,
} from '@stocket/types/audit-logs';
import {
  resolvePaginationWindow,
  toRepositoryPaginatedResult,
} from '@stocket/types/common';
import { makeTryAsync } from '../../platform/try-async';
import { TenantQuery } from '../../platform/tenant-query';
import { DrizzleDatabase } from '../../platform/drizzle';
import { auditLogs, betterAuthUsers } from '../../platform/db/schema';
import { AuditLogsInfrastructureError } from './audit-logs.errors';

export interface AuditLogQueryOptions {
  readonly entity_type?: AuditEntityType;
  readonly entity_id?: string;
  readonly user_id?: string;
  readonly action?: AuditAction;
  readonly from_date?: Date;
  readonly to_date?: Date;
  readonly page?: number;
  readonly limit?: number;
}

const tryAsync = makeTryAsync(
  (action, cause) =>
    new AuditLogsInfrastructureError({
      action,
      cause,
      messageKey: 'auditLogs.repositoryFailed',
    }),
);

export type AuditLogRowWithUser = typeof auditLogs.$inferSelect & {
  readonly user_name: string | null;
};

function buildAuditFilters(options: AuditLogQueryOptions): SQL[] {
  const conditions: SQL[] = [];
  if (options.entity_type) {
    conditions.push(eq(auditLogs.entity_type, options.entity_type));
  }
  if (options.entity_id) {
    conditions.push(eq(auditLogs.entity_id, options.entity_id));
  }
  if (options.user_id) {
    conditions.push(eq(auditLogs.user_id, options.user_id));
  }
  if (options.action) {
    conditions.push(eq(auditLogs.action, options.action));
  }
  if (options.from_date) {
    conditions.push(gte(auditLogs.created_at, options.from_date));
  }
  if (options.to_date) {
    conditions.push(lte(auditLogs.created_at, options.to_date));
  }
  return conditions;
}

export class AuditLogsRepository extends Effect.Service<AuditLogsRepository>()(
  '@stocket/effect/audit-logs/AuditLogsRepository',
  {
    effect: Effect.gen(function* () {
      const db = yield* DrizzleDatabase;
      const tenantQuery = yield* TenantQuery;
      const auditLogSelect = {
        ...getTableColumns(auditLogs),
        user_name: betterAuthUsers.name,
      };

      const findPaginated = (options: AuditLogQueryOptions) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('query audit logs', async () => {
            const { page, limit, skip } = resolvePaginationWindow(
              options.page,
              options.limit,
            );
            const where = and(
              eq(auditLogs.tenant_id, tenantId),
              ...buildAuditFilters(options),
            );

            const [countResult, data] = await Promise.all([
              db
                .select({ count: sql<number>`count(*)::int` })
                .from(auditLogs)
                .where(where),
              db
                .select(auditLogSelect)
                .from(auditLogs)
                .leftJoin(
                  betterAuthUsers,
                  eq(auditLogs.user_id, betterAuthUsers.id),
                )
                .where(where)
                .orderBy(desc(auditLogs.created_at))
                .offset(skip)
                .limit(limit),
            ]);

            const total = countResult[0]?.count ?? 0;
            return toRepositoryPaginatedResult(data, total, page, limit);
          });
        });

      const findById = (id: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load audit log', async () => {
            const rows = await db
              .select(auditLogSelect)
              .from(auditLogs)
              .leftJoin(
                betterAuthUsers,
                eq(auditLogs.user_id, betterAuthUsers.id),
              )
              .where(
                and(eq(auditLogs.tenant_id, tenantId), eq(auditLogs.id, id)),
              )
              .limit(1);
            return rows[0] ?? null;
          });
        });

      const findByEntityId = (entityType: AuditEntityType, entityId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load entity audit history', () =>
            db
              .select(auditLogSelect)
              .from(auditLogs)
              .leftJoin(
                betterAuthUsers,
                eq(auditLogs.user_id, betterAuthUsers.id),
              )
              .where(
                and(
                  eq(auditLogs.tenant_id, tenantId),
                  eq(auditLogs.entity_type, entityType),
                  eq(auditLogs.entity_id, entityId),
                ),
              )
              .orderBy(desc(auditLogs.created_at)),
          );
        });

      const findByUserId = (userId: string) =>
        Effect.gen(function* () {
          const tenantId = yield* tenantQuery.tenantId;
          return yield* tryAsync('load user audit history', () =>
            db
              .select(auditLogSelect)
              .from(auditLogs)
              .leftJoin(
                betterAuthUsers,
                eq(auditLogs.user_id, betterAuthUsers.id),
              )
              .where(
                and(
                  eq(auditLogs.tenant_id, tenantId),
                  eq(auditLogs.user_id, userId),
                ),
              )
              .orderBy(desc(auditLogs.created_at)),
          );
        });

      return { findPaginated, findById, findByEntityId, findByUserId };
    }),
    dependencies: [TenantQuery.Default],
  },
) {}
