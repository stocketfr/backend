import { eq } from 'drizzle-orm';
import {
  categories,
  inventory,
  locations,
  organizations,
  platformAuditEvents,
  products,
  superAdmins,
} from '../../platform/db/schema';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { makeTestHttpAppHandler } from '../../testing/app-harness';
import {
  getTestDb,
  seedBetterAuthUser,
  TEST_USER_ID,
  withTestDb,
} from '../../testing/test-harness';
import type { BetterAuthStubOptions } from '../../testing/better-auth-test';

let db: DrizzleDb;

const PLATFORM_HOST = 'app.stocket.fr';
const PLATFORM_ORIGIN = `http://${PLATFORM_HOST}`;
const TENANT_ADMIN_ID = '00000000-0000-4000-a000-000000000901';

interface PasswordResetRequest {
  readonly body: {
    readonly email: string;
    readonly redirectTo: string;
  };
}

const makeSession = (userId = TEST_USER_ID) => ({
  user: {
    id: userId,
    name: 'Platform Admin',
    email: `${userId}@example.com`,
    image: null,
    emailVerified: true,
    createdAt: new Date('2026-06-01T08:00:00.000Z'),
    updatedAt: new Date('2026-06-01T08:00:00.000Z'),
    role: 'user' as const,
  },
  session: {
    id: `session-${userId}`,
    userId,
    token: `token-${userId}`,
    createdAt: new Date('2026-06-01T08:00:00.000Z'),
    updatedAt: new Date('2026-06-01T08:00:00.000Z'),
    expiresAt: new Date('2026-07-01T08:00:00.000Z'),
    activeOrganizationId: null,
  },
});

const platformRequest = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('host', PLATFORM_HOST);

  return new Request(`${PLATFORM_ORIGIN}${path}`, {
    ...init,
    headers,
  });
};

const makeCreateTenantForm = (
  overrides: Partial<{
    readonly name: string;
    readonly slug: string;
    readonly adminName: string;
    readonly adminEmail: string;
    readonly adminPassword: string;
    readonly importFile: File;
  }> = {},
) => {
  const formData = new FormData();
  formData.append('name', overrides.name ?? 'Imported Tenant');
  formData.append('slug', overrides.slug ?? 'imported-tenant');
  formData.append('admin_name', overrides.adminName ?? 'Tenant Admin');
  formData.append(
    'admin_email',
    overrides.adminEmail ?? 'tenant-admin@example.com',
  );
  formData.append('admin_password', overrides.adminPassword ?? 'password123');
  if (overrides.importFile) {
    formData.append('import_file', overrides.importFile);
  }
  return formData;
};

async function seedPlatformSuperAdmin(userId = TEST_USER_ID) {
  await seedBetterAuthUser(db, {
    id: userId,
    email: `${userId}@example.com`,
    name: 'Platform Admin',
  });
  await db
    .insert(superAdmins)
    .values({ user_id: userId })
    .onConflictDoNothing();
}

const makeBetterAuthOverrides = () => ({
  createUser: vi.fn(async () => ({ user: { id: TENANT_ADMIN_ID } })),
  requestPasswordReset: vi.fn(async (_request: PasswordResetRequest) => ({
    status: true,
  })),
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForMockCall(spy: ReturnType<typeof vi.fn>) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (spy.mock.calls.length > 0) {
      return;
    }
    await delay(10);
  }
}

async function waitForTenantCreateAudit(slug: string) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const rows = await db
      .select({ metadata: platformAuditEvents.metadata })
      .from(platformAuditEvents);
    if (
      rows.some(
        (row) =>
          typeof row.metadata === 'object' &&
          row.metadata !== null &&
          'slug' in row.metadata &&
          row.metadata.slug === slug,
      )
    ) {
      return;
    }
    await delay(10);
  }
}

async function postCreateTenant(
  formData: FormData,
  betterAuthOverrides = makeBetterAuthOverrides(),
) {
  const slug = formData.get('slug');
  await seedPlatformSuperAdmin();
  const { handler, dispose } = makeTestHttpAppHandler({
    session: makeSession(TEST_USER_ID),
    betterAuthOverrides:
      betterAuthOverrides as unknown as BetterAuthStubOptions['overrides'],
  });

  try {
    const response = await handler(
      platformRequest('/api/v1/superadmin/tenants', {
        method: 'POST',
        body: formData,
      }),
    );
    const json = await response.json();
    if (response.status === 201 && typeof slug === 'string') {
      await waitForTenantCreateAudit(slug);
    }
    return { response, body: json, betterAuthOverrides };
  } finally {
    await dispose();
  }
}

async function findTenantBySlug(slug: string) {
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return rows[0] ?? null;
}

withTestDb();
beforeAll(() => {
  db = getTestDb();
});

describe('POST /api/v1/superadmin/tenants import', () => {
  it('creates a tenant from multipart fields without an import file', async () => {
    const result = await postCreateTenant(
      makeCreateTenantForm({ slug: 'tenant-without-file' }),
    );

    expect(result.response.status).toBe(201);
    expect(result.body).toMatchObject({
      tenant: { slug: 'tenant-without-file' },
      admin: {
        id: TENANT_ADMIN_ID,
        email: 'tenant-admin@example.com',
        name: 'Tenant Admin',
      },
    });
    expect(result.body.productImport).toBeUndefined();
    await expect(findTenantBySlug('tenant-without-file')).resolves.toBeTruthy();
  });

  it('creates a tenant and imports a valid product CSV into that tenant', async () => {
    const csv = `sku,name,category_path,reorder_point,quantity,location,unit
IMP-001,Imported Whisky,Spirits,4,9,Main Warehouse,bottle
`;
    const result = await postCreateTenant(
      makeCreateTenantForm({
        slug: 'tenant-with-import',
        importFile: new File([csv], 'products.csv', { type: 'text/csv' }),
      }),
    );

    expect(result.response.status).toBe(201);
    expect(result.body.productImport).toMatchObject({
      categoriesCreated: 1,
      locationsCreated: 1,
      productsCreated: 1,
      inventoryRecordsCreated: 1,
      rowsSkipped: 0,
      errors: [],
    });

    const tenant = await findTenantBySlug('tenant-with-import');
    expect(tenant).toBeTruthy();

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.tenant_id, tenant!.id))
      .limit(1);
    expect(product).toMatchObject({
      sku: 'IMP-001',
      name: 'Imported Whisky',
      created_by: TENANT_ADMIN_ID,
      updated_by: TENANT_ADMIN_ID,
    });

    await expect(
      db.select().from(categories).where(eq(categories.tenant_id, tenant!.id)),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(locations).where(eq(locations.tenant_id, tenant!.id)),
    ).resolves.toHaveLength(1);
    await expect(
      db.select().from(inventory).where(eq(inventory.tenant_id, tenant!.id)),
    ).resolves.toHaveLength(1);

    const [auditEvent] = await db
      .select()
      .from(platformAuditEvents)
      .where(eq(platformAuditEvents.entity_id, tenant!.id))
      .limit(1);
    expect(auditEvent?.metadata).toMatchObject({
      productImport: {
        filename: 'products.csv',
        productsCreated: 1,
        inventoryRecordsCreated: 1,
      },
    });

    await waitForMockCall(result.betterAuthOverrides.requestPasswordReset);
    expect(
      result.betterAuthOverrides.requestPasswordReset,
    ).toHaveBeenCalledTimes(1);
    expect(
      result.betterAuthOverrides.requestPasswordReset.mock.calls[0]?.[0]?.body,
    ).toMatchObject({
      email: 'tenant-admin@example.com',
      redirectTo:
        'http://tenant-with-import.localhost:3000/reset-password?flow=welcome',
    });
  });

  it('rejects an invalid import file without creating a tenant', async () => {
    const overrides = makeBetterAuthOverrides();
    const result = await postCreateTenant(
      makeCreateTenantForm({
        slug: 'tenant-invalid-import',
        importFile: new File(
          ['sku,name,category_path\n,Missing SKU,Food\n'],
          'invalid.csv',
          { type: 'text/csv' },
        ),
      }),
      overrides,
    );

    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({
      messageKey: 'superadmin.tenantImportInvalid',
    });
    expect(result.body.message).toContain('Row 2');
    await expect(findTenantBySlug('tenant-invalid-import')).resolves.toBeNull();
    expect(overrides.createUser).not.toHaveBeenCalled();
  });

  it('rolls back the tenant when import fails inside the transaction', async () => {
    const longCategoryName = 'A'.repeat(101);
    const overrides = makeBetterAuthOverrides();
    const result = await postCreateTenant(
      makeCreateTenantForm({
        slug: 'tenant-rollback-import',
        adminEmail: 'rollback-admin@example.com',
        importFile: new File(
          [`sku,name,category_path\nROLLBACK-1,Rollback,${longCategoryName}\n`],
          'rollback.csv',
          { type: 'text/csv' },
        ),
      }),
      overrides,
    );

    expect(result.response.status).toBe(400);
    expect(result.body).toMatchObject({
      messageKey: 'superadmin.tenantImportInvalid',
    });
    await expect(
      findTenantBySlug('tenant-rollback-import'),
    ).resolves.toBeNull();
    expect(overrides.createUser).toHaveBeenCalledTimes(1);
    expect(overrides.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('rejects JSON tenant creation because the endpoint is multipart-only', async () => {
    await seedPlatformSuperAdmin();
    const betterAuthOverrides = makeBetterAuthOverrides();
    const { handler, dispose } = makeTestHttpAppHandler({
      session: makeSession(TEST_USER_ID),
      betterAuthOverrides:
        betterAuthOverrides as unknown as BetterAuthStubOptions['overrides'],
    });

    try {
      const response = await handler(
        platformRequest('/api/v1/superadmin/tenants', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: 'JSON Tenant',
            slug: 'json-tenant',
            admin: {
              name: 'Tenant Admin',
              email: 'json-tenant-admin@example.com',
              password: 'password123',
            },
          }),
        }),
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      await expect(findTenantBySlug('json-tenant')).resolves.toBeNull();
      expect(betterAuthOverrides.createUser).not.toHaveBeenCalled();
    } finally {
      await dispose();
    }
  });
});
