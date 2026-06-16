import { HttpServerRequest } from '@effect/platform';
import { and, eq } from 'drizzle-orm';
import { Effect, Layer } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { makeBetterAuthTestLayer } from '../../testing/better-auth-test';
import {
  getTestDb,
  makeTestDrizzleLayer,
  TEST_USER_ID,
  withTestDb,
} from '../../testing/test-harness';
import { auditLogs } from '../db/schema';
import type { DrizzleDb } from '../db/drizzle';
import { CurrentRequestContext, type RequestContext } from '../http/request-context';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-constants';
import { makeAuditLogWriter } from '../audit/index';

const TEST_ENTITY_ID = '00000000-0000-4000-b000-000000000101';

let db: DrizzleDb;

withTestDb();
beforeAll(() => {
  db = getTestDb();
});

const makeSession = () => ({
  user: {
    id: TEST_USER_ID,
    name: 'Audit Integration User',
    email: 'audit-integration@example.com',
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-05-24T08:00:00.000Z'),
    updatedAt: new Date('2026-05-24T08:00:00.000Z'),
    role: 'user' as const,
  },
  session: {
    id: 'session-audit-integration',
    userId: TEST_USER_ID,
    token: 'token-audit-integration',
    createdAt: new Date('2026-05-24T08:00:00.000Z'),
    updatedAt: new Date('2026-05-24T08:00:00.000Z'),
    expiresAt: new Date('2026-06-24T08:00:00.000Z'),
    activeOrganizationId: null,
  },
});

const requestContext: RequestContext = {
  requestId: '00000000-0000-4000-8000-000000000199',
  path: '/api/v1/inventory',
  method: 'POST',
  ip: '203.0.113.20',
  locale: 'en',
  tenantId: DEFAULT_TENANT_ID,
};

const TestLayer = Layer.mergeAll(
  makeTestDrizzleLayer(),
  makeBetterAuthTestLayer({
    overrides: {
      getSession: async () => makeSession(),
    } as never,
  }),
  Layer.succeed(
    HttpServerRequest.HttpServerRequest,
    HttpServerRequest.fromWeb(new Request('http://localhost/api/v1/inventory')),
  ),
  Layer.succeed(CurrentRequestContext, requestContext),
);

async function waitForAuditLog(entityId: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const rows = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entity_id, entityId),
          eq(auditLogs.entity_type, AuditEntityType.INVENTORY),
        ),
      )
      .limit(1);
    if (rows[0]) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for audit log for ${entityId}`);
}

describe('makeAuditLogWriter integration', () => {
  it('persists audit rows through the real database writer', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const writer = yield* makeAuditLogWriter;
        yield* writer.log({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.INVENTORY,
          entityId: TEST_ENTITY_ID,
        });
      }).pipe(Effect.provide(TestLayer)),
    );

    const row = await waitForAuditLog(TEST_ENTITY_ID);
    expect(row).toMatchObject({
      tenant_id: DEFAULT_TENANT_ID,
      user_id: TEST_USER_ID,
      action: AuditAction.CREATE,
      entity_type: AuditEntityType.INVENTORY,
      entity_id: TEST_ENTITY_ID,
      ip_address: '203.0.113.20',
    });
  });
});
