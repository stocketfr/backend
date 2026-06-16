import { Effect, Layer } from 'effect';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserSession } from '../auth/user-session';
import { members, organizations } from '../db/schema';
import { DrizzleDatabase } from '../db/drizzle';
import { CurrentRequestContext, type RequestContext } from '../http/request-context';
import {
  resolveTenantForSession,
  TenantMembershipRejected,
  TenantNotResolved,
} from '../tenancy/tenant-context';
import {
  getTestDb,
  seedBetterAuthUser,
  withTestDb,
} from '../../testing/test-harness';

withTestDb();

const USER_ID = '00000000-0000-4000-a000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-a000-000000000002';
const ORG_ID = '00000000-0000-4000-8000-000000000101';
const OTHER_ORG_ID = '00000000-0000-4000-8000-000000000102';

const makeSession = (
  activeOrganizationId: string | null = null,
  userId = USER_ID,
): UserSession =>
  ({
    user: {
      id: userId,
      name: 'Tenant Test User',
      email: 'tenant@example.com',
      image: null,
      emailVerified: true,
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-10T12:00:00.000Z'),
      role: 'admin',
    },
    session: {
      id: 'session-tenant',
      userId,
      token: 'tok',
      createdAt: new Date('2026-03-10T12:00:00.000Z'),
      updatedAt: new Date('2026-03-10T12:00:00.000Z'),
      expiresAt: new Date('2026-03-17T12:00:00.000Z'),
      activeOrganizationId,
    },
  }) as UserSession;

const makeRequestContext = (): RequestContext => ({
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/products',
  method: 'GET',
  ip: null,
  locale: 'en',
});

const seedMembership = async (
  organizationId: string,
  userId = USER_ID,
  name = 'Tenant Org',
) => {
  const db = getTestDb();
  await seedBetterAuthUser(db, { id: userId });
  await db.insert(organizations).values({
    id: organizationId,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
  });
  await db.insert(members).values({
    id: `${organizationId}:${userId}`,
    organization_id: organizationId,
    user_id: userId,
    role: 'member',
  });
};

beforeEach(async () => {
  const db = getTestDb();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "organization" (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      logo TEXT,
      metadata TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "member" (
      id TEXT PRIMARY KEY,
      organization_id UUID NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT member_user_organization_unique UNIQUE (user_id, organization_id)
    )
  `);
});

const run = <A, E>(
  effect: Effect.Effect<A, E>,
  requestContext = makeRequestContext(),
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(Layer.succeed(DrizzleDatabase, getTestDb())),
      Effect.provide(Layer.succeed(CurrentRequestContext, requestContext)),
    ),
  );

describe('resolveTenantForSession', () => {
  it('resolves and stores the active organization when the user is a member', async () => {
    await seedMembership(ORG_ID, USER_ID, 'Active Org');
    const requestContext = makeRequestContext();

    const tenant = await run(
      resolveTenantForSession(makeSession(ORG_ID)),
      requestContext,
    );

    expect(tenant).toEqual({
      tenantId: ORG_ID,
      tenantName: 'Active Org',
      tenantSlug: 'active-org',
    });
    expect(requestContext.tenantId).toBe(ORG_ID);
  });

  it('rejects an active organization when the user is not a member', async () => {
    await seedMembership(ORG_ID, OTHER_USER_ID, 'Other Org');

    const error = await run(
      resolveTenantForSession(makeSession(ORG_ID)).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(TenantMembershipRejected);
  });

  it('falls back to a single organization membership', async () => {
    await seedMembership(ORG_ID, USER_ID, 'Only Org');

    const tenant = await run(resolveTenantForSession(makeSession(null)));

    expect(tenant.tenantId).toBe(ORG_ID);
    expect(tenant.tenantName).toBe('Only Org');
  });

  it('rejects missing active organization when the user has multiple memberships', async () => {
    await seedMembership(ORG_ID, USER_ID, 'First Org');
    await seedMembership(OTHER_ORG_ID, USER_ID, 'Second Org');

    const error = await run(
      resolveTenantForSession(makeSession(null)).pipe(Effect.flip),
    );

    expect(error).toBeInstanceOf(TenantNotResolved);
  });
});
