import { randomUUID } from 'node:crypto';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  getDbConnectionParams,
  getPoolMax,
  getSSLConfig,
  IDLE_TIMEOUT_MS,
} from '../config/db-connection.utils';
import {
  DEFAULT_TENANT_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_TENANT_SLUG,
} from '../effect/platform/tenancy/tenant-constants';
import { hostnameForTenantSlug } from '../effect/platform/tenancy/host';
import { defaultRoleSeedDefinitions } from '../effect/platform/seed/default-roles';
import { repairBetterAuthSchema } from '../effect/platform/db/better-auth-schema-repair';
import { seedTenantData } from './seed/run';

const usage = `Seed a tenant (organization/domain + admin + default roles + demo data).

Usage:
  TENANT_ADMIN_EMAIL=<email> \\
  TENANT_ADMIN_NAME='<display name>' \\
  TENANT_ADMIN_PASSWORD=<password> \\
  tsx src/scripts/seed-tenant-admin.ts

  pnpm --filter @stocket/api tenant:seed:workspace

Environment variables:
  TENANT_ADMIN_EMAIL             Required. Login email for the initial tenant admin.
  TENANT_ADMIN_NAME              Required. Display name.
  TENANT_ADMIN_PASSWORD_HASH     Hash produced by superadmin:hash-password.
  TENANT_ADMIN_PASSWORD          Plaintext password alternative to TENANT_ADMIN_PASSWORD_HASH.
  TENANT_ADMIN_ROTATE_PASSWORD   "true" to overwrite the password of an existing credential account.
  TENANT_ADMIN_TENANT_ID         Tenant id. If omitted, prompts from available tenants.
  TENANT_ADMIN_TENANT_SLUG       Tenant slug. Mutually exclusive with TENANT_ADMIN_TENANT_ID.
  TENANT_ADMIN_TENANT_HOSTNAME   Primary tenant hostname. Defaults from the tenant slug.

If no tenant id or slug is provided, the script lists available tenants and
prompts for a selection. If no tenants exist, it creates the Stocket default tenant.
Tenant-scoped demo data is cleared and reseeded for the selected tenant.
`;

interface BetterAuthUserRow {
  readonly id: string;
}

interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

interface RoleRow {
  readonly id: string;
}

interface TenantAdminSeedConfig {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly rotatePassword: boolean;
  readonly tenantId?: string;
  readonly tenantSlug?: string;
  readonly tenantHostname?: string;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readRequiredEnv(name: string): string {
  const value = readOptionalEnv(name);
  if (!value) {
    throw new Error(`${name} is required. Run with --help for usage.`);
  }
  return value;
}

function readBooleanEnv(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === 'true';
}

function buildPoolConfig(): pg.PoolConfig {
  const connParams = getDbConnectionParams();
  const ssl = getSSLConfig();
  const max = getPoolMax();

  if ('url' in connParams) {
    return {
      connectionString: connParams.url,
      ssl: ssl || undefined,
      max,
      idleTimeoutMillis: IDLE_TIMEOUT_MS,
    };
  }

  return {
    host: connParams.host,
    port: connParams.port,
    user: connParams.user,
    password: connParams.password,
    database: connParams.database,
    ssl: ssl || undefined,
    max,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  };
}

async function readPasswordHash(): Promise<string> {
  const passwordHash = readOptionalEnv('TENANT_ADMIN_PASSWORD_HASH');
  if (passwordHash) {
    return passwordHash;
  }

  const password = readOptionalEnv('TENANT_ADMIN_PASSWORD');
  if (password) {
    return hashPassword(password);
  }

  throw new Error(
    'TENANT_ADMIN_PASSWORD_HASH or TENANT_ADMIN_PASSWORD is required. Run with --help for usage.',
  );
}

async function readSeedConfig(): Promise<TenantAdminSeedConfig> {
  const tenantId = readOptionalEnv('TENANT_ADMIN_TENANT_ID');
  const tenantSlug = readOptionalEnv('TENANT_ADMIN_TENANT_SLUG');
  if (tenantId && tenantSlug) {
    throw new Error(
      'Set only one tenant target: TENANT_ADMIN_TENANT_ID or TENANT_ADMIN_TENANT_SLUG.',
    );
  }

  return {
    email: normalizeEmail(readRequiredEnv('TENANT_ADMIN_EMAIL')),
    name: readRequiredEnv('TENANT_ADMIN_NAME'),
    passwordHash: await readPasswordHash(),
    rotatePassword: readBooleanEnv('TENANT_ADMIN_ROTATE_PASSWORD'),
    tenantId,
    tenantSlug,
    tenantHostname: readOptionalEnv('TENANT_ADMIN_TENANT_HOSTNAME'),
  };
}

async function selectTenantTarget(
  client: pg.PoolClient,
  config: TenantAdminSeedConfig,
): Promise<TenantRow | undefined> {
  if (config.tenantSlug) {
    const tenantResult = await client.query<TenantRow>(
      'SELECT id, name, slug FROM organization WHERE slug = $1 LIMIT 1',
      [config.tenantSlug],
    );
    const tenant = tenantResult.rows[0];
    if (!tenant) {
      throw new Error(`Tenant not found for slug "${config.tenantSlug}".`);
    }
    return tenant;
  }

  if (!config.tenantId) {
    return selectTenantFromAvailable(client);
  }

  const tenantResult = await client.query<TenantRow>(
    'SELECT id, name, slug FROM organization WHERE id = $1 LIMIT 1',
    [config.tenantId],
  );
  const tenant = tenantResult.rows[0];
  if (tenant) {
    return tenant;
  }

  if (config.tenantId === DEFAULT_TENANT_ID) {
    return undefined;
  }

  throw new Error(`Tenant not found for id "${config.tenantId}".`);
}

async function selectTenantFromAvailable(
  client: pg.PoolClient,
): Promise<TenantRow | undefined> {
  const tenantsResult = await client.query<TenantRow>(
    `
      SELECT id, name, slug
      FROM organization
      ORDER BY lower(slug), lower(name), id
    `,
  );

  if (tenantsResult.rows.length === 0) {
    console.log('No tenants found. Creating the Stocket default tenant.');
    return undefined;
  }

  if (tenantsResult.rows.length === 1) {
    const tenant = tenantsResult.rows[0];
    if (tenant) {
      console.log(`Selected only available tenant: ${formatTenant(tenant)}.`);
      return tenant;
    }
  }

  return promptForTenantSelection(tenantsResult.rows);
}

function formatTenant(tenant: TenantRow): string {
  return `${tenant.name} (${tenant.slug}, ${tenant.id})`;
}

async function promptForTenantSelection(
  tenants: ReadonlyArray<TenantRow>,
): Promise<TenantRow> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      'Multiple tenants are available. Set TENANT_ADMIN_TENANT_ID or TENANT_ADMIN_TENANT_SLUG for non-interactive runs.',
    );
  }

  console.log('Available tenants:');
  tenants.forEach((tenant, index) => {
    console.log(`  ${index + 1}. ${formatTenant(tenant)}`);
  });

  const rl = createInterface({ input, output });
  try {
    while (true) {
      const answer = (
        await rl.question(`Select tenant [1-${tenants.length}]: `)
      ).trim();
      const selectedIndex = Number(answer);
      const tenant = tenants[selectedIndex - 1];

      if (
        Number.isInteger(selectedIndex) &&
        selectedIndex >= 1 &&
        selectedIndex <= tenants.length &&
        tenant
      ) {
        return tenant;
      }

      console.log(`Enter a number from 1 to ${tenants.length}.`);
    }
  } finally {
    rl.close();
  }
}

async function createDefaultTenant(client: pg.PoolClient): Promise<TenantRow> {
  const created = await client.query<TenantRow>(
    `
      INSERT INTO organization (id, name, slug)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE
      SET name = EXCLUDED.name,
          slug = EXCLUDED.slug
      RETURNING id, name, slug
    `,
    [DEFAULT_TENANT_ID, DEFAULT_TENANT_NAME, DEFAULT_TENANT_SLUG],
  );
  return created.rows[0]!;
}

async function ensureTenantHostname(
  client: pg.PoolClient,
  tenant: TenantRow,
  configuredHostname: string | undefined,
): Promise<string> {
  const hostname = configuredHostname ?? hostnameForTenantSlug(tenant.slug);
  const updated = await client.query(
    `
      UPDATE tenant_domains
      SET hostname = $2,
          kind = 'subdomain',
          is_primary = true,
          verified_at = NOW()
      WHERE tenant_id = $1 AND is_primary = true
    `,
    [tenant.id, hostname],
  );

  if (updated.rowCount === 0) {
    await client.query(
      `
        INSERT INTO tenant_domains (tenant_id, hostname, kind, is_primary, verified_at)
        VALUES ($1, $2, 'subdomain', true, NOW())
        ON CONFLICT (hostname) DO UPDATE
        SET tenant_id = EXCLUDED.tenant_id,
            kind = EXCLUDED.kind,
            is_primary = EXCLUDED.is_primary,
            verified_at = EXCLUDED.verified_at
      `,
      [tenant.id, hostname],
    );
  }

  return hostname;
}

async function ensureUser(
  client: pg.PoolClient,
  config: TenantAdminSeedConfig,
): Promise<string> {
  const existingUserResult = await client.query<BetterAuthUserRow>(
    'SELECT id FROM "user" WHERE lower(email) = $1 LIMIT 1',
    [config.email],
  );
  const existingUser = existingUserResult.rows[0];
  if (existingUser) {
    await client.query(
      `
        UPDATE "user"
        SET name = $2,
            email_verified = true,
            updated_at = NOW()
        WHERE id = $1
      `,
      [existingUser.id, config.name],
    );
    return existingUser.id;
  }

  const userId = randomUUID();
  await client.query(
    `
      INSERT INTO "user" (
        id,
        name,
        email,
        email_verified,
        role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, true, 'user', NOW(), NOW())
    `,
    [userId, config.name, config.email],
  );
  return userId;
}

async function ensureCredentialAccount(
  client: pg.PoolClient,
  userId: string,
  passwordHash: string,
  rotatePassword: boolean,
): Promise<void> {
  const accountResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM account
      WHERE user_id = $1 AND provider_id = 'credential'
      LIMIT 1
    `,
    [userId],
  );
  const credentialAccountId = accountResult.rows[0]?.id;

  if (!credentialAccountId) {
    await client.query(
      `
        INSERT INTO account (
          id,
          account_id,
          provider_id,
          user_id,
          password,
          created_at,
          updated_at
        )
        VALUES ($1, $2, 'credential', $3, $4, NOW(), NOW())
      `,
      [randomUUID(), userId, userId, passwordHash],
    );
    return;
  }

  if (rotatePassword) {
    await client.query(
      `
        UPDATE account
        SET password = $1, updated_at = NOW()
        WHERE id = $2
      `,
      [passwordHash, credentialAccountId],
    );
  }
}

async function ensureDefaultRoles(
  client: pg.PoolClient,
  tenantId: string,
): Promise<string> {
  let adminRoleId: string | undefined;

  for (const seed of defaultRoleSeedDefinitions) {
    const roleResult = await client.query<RoleRow>(
      `
        INSERT INTO roles (tenant_id, name, description, is_system)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (tenant_id, name) DO UPDATE
        SET description = EXCLUDED.description,
            is_system = EXCLUDED.is_system
        RETURNING id
      `,
      [tenantId, seed.name, seed.description],
    );
    const roleId = roleResult.rows[0]!.id;
    if (seed.name === 'Admin') {
      adminRoleId = roleId;
    }

    for (const permission of seed.permissions) {
      await client.query(
        `
          INSERT INTO role_permissions (role_id, resource, permission)
          VALUES ($1, $2, $3)
          ON CONFLICT (role_id, resource, permission) DO NOTHING
        `,
        [roleId, permission.resource, permission.permission],
      );
    }
  }

  if (!adminRoleId) {
    throw new Error('Admin role was not seeded.');
  }

  return adminRoleId;
}

async function seedTenant(): Promise<void> {
  const config = await readSeedConfig();
  const pool = new pg.Pool(buildPoolConfig());
  let client: pg.PoolClient | undefined;
  let transactionStarted = false;

  try {
    client = await pool.connect();
    const selectedTenant = await selectTenantTarget(client, config);

    await client.query('BEGIN');
    transactionStarted = true;
    const db = drizzle(client);
    await repairBetterAuthSchema(db);

    const tenant = selectedTenant ?? (await createDefaultTenant(client));
    const hostname = await ensureTenantHostname(
      client,
      tenant,
      config.tenantHostname,
    );
    const userId = await ensureUser(client, config);
    await ensureCredentialAccount(
      client,
      userId,
      config.passwordHash,
      config.rotatePassword,
    );
    const adminRoleId = await ensureDefaultRoles(client, tenant.id);

    await client.query(
      `
        INSERT INTO member (id, organization_id, user_id, role)
        VALUES ($1, $2, $3, 'member')
        ON CONFLICT (user_id, organization_id) DO NOTHING
      `,
      [randomUUID(), tenant.id, userId],
    );

    await client.query(
      `
        INSERT INTO user_roles (tenant_id, user_id, role_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, user_id, role_id) DO NOTHING
      `,
      [tenant.id, userId, adminRoleId],
    );

    await seedTenantData({
      db,
      tenant,
      store: new Map(),
    });

    await client.query('COMMIT');
    transactionStarted = false;
    console.log(
      `Seeded tenant ${tenant.slug} (${hostname}) with admin ${config.email}.`,
    );
  } catch (error) {
    if (client && transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage);
    return;
  }

  await seedTenant();
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
