import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';
import {
  getDatabaseUrl,
  getPoolMax,
  getSSLConfig,
  IDLE_TIMEOUT_MS,
} from '../config/db-connection.utils';

const usage = `Seed a platform superadmin (better-auth user + super_admins row).

Usage:
  # 1. Hash the password (read from stdin)
  printf '%s' 'your-password' | pnpm --filter @stocket/api superadmin:hash-password

  # 2. Seed the account
  SUPERADMIN_EMAIL=<email> \\
  SUPERADMIN_NAME='<display name>' \\
  SUPERADMIN_PASSWORD_HASH='<hash from step 1>' \\
  tsx src/scripts/seed-superadmin.ts

Options:
  --hash-password   Read a password from stdin, print its better-auth hash, and exit.
  --help, -h        Show this message.

Environment variables (seed mode):
  SUPERADMIN_EMAIL                Required. Login email for the superadmin.
  SUPERADMIN_NAME                 Required. Display name (used only when creating a new user).
  SUPERADMIN_PASSWORD_HASH        Hash produced by --hash-password.
  SUPERADMIN_PASSWORD             Plaintext password alternative to SUPERADMIN_PASSWORD_HASH.
  SUPERADMIN_ROTATE_PASSWORD      "true" to overwrite the password of an existing credential account.
  SUPERADMIN_ALLOW_TENANT_MEMBER  "true" to promote a user that already belongs to a tenant.
                                  Refused by default: superadmins are platform-only accounts.

Notes:
  - Connects using the same DATABASE_URL setting as the API server.
  - Idempotent: reruns keep the existing user, credential account, and super_admins row.
  - Sign in on the platform host (localhost:3000 in dev) and open /platform.
`;

interface BetterAuthUserRow {
  readonly id: string;
  readonly email: string | null;
  readonly name: string | null;
}

export interface SuperAdminSeedConfig {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly rotatePassword: boolean;
  readonly allowTenantMember: boolean;
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

async function readStdin(): Promise<string> {
  let value = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    value += chunk;
  }
  return value.replace(/\r?\n$/, '');
}

function buildPoolConfig(): pg.PoolConfig {
  const connectionString = getDatabaseUrl();
  const ssl = getSSLConfig();
  const max = getPoolMax();

  return {
    connectionString,
    ssl: ssl || undefined,
    max,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  };
}

async function runHashPassword(): Promise<void> {
  const password = await readStdin();
  if (!password) {
    throw new Error('Password must be supplied on stdin');
  }
  process.stdout.write(`${await hashPassword(password)}\n`);
}

async function readPasswordHash(): Promise<string> {
  const passwordHash = readOptionalEnv('SUPERADMIN_PASSWORD_HASH');
  if (passwordHash) {
    return passwordHash;
  }

  const password = readOptionalEnv('SUPERADMIN_PASSWORD');
  if (password) {
    return hashPassword(password);
  }

  throw new Error(
    'SUPERADMIN_PASSWORD_HASH or SUPERADMIN_PASSWORD is required. Run with --help for usage.',
  );
}

async function readSeedConfig(): Promise<SuperAdminSeedConfig> {
  return {
    email: normalizeEmail(readRequiredEnv('SUPERADMIN_EMAIL')),
    name: readRequiredEnv('SUPERADMIN_NAME'),
    passwordHash: await readPasswordHash(),
    rotatePassword: readBooleanEnv('SUPERADMIN_ROTATE_PASSWORD'),
    allowTenantMember: readBooleanEnv('SUPERADMIN_ALLOW_TENANT_MEMBER'),
  };
}

export async function seedSuperAdmin(
  config?: SuperAdminSeedConfig,
  poolConfig: pg.PoolConfig = buildPoolConfig(),
): Promise<void> {
  const { email, name, passwordHash, rotatePassword, allowTenantMember } =
    config ?? (await readSeedConfig());

  const pool = new pg.Pool(poolConfig);
  let client: pg.PoolClient | undefined;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const existingUserResult = await client.query<BetterAuthUserRow>(
      'SELECT id, email, name FROM "user" WHERE lower(email) = $1 LIMIT 1',
      [email],
    );

    const existingUser = existingUserResult.rows[0] ?? null;
    let userId = existingUser?.id ?? null;

    if (userId) {
      const tenantMemberResult = await client.query(
        'SELECT 1 FROM member WHERE user_id = $1 LIMIT 1',
        [userId],
      );

      if (tenantMemberResult.rowCount && !allowTenantMember) {
        throw new Error(
          [
            'SUPERADMIN_EMAIL already belongs to a tenant member.',
            'Use a platform-only account or set SUPERADMIN_ALLOW_TENANT_MEMBER=true deliberately.',
          ].join(' '),
        );
      }
    } else {
      userId = randomUUID();
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
        [userId, name, email],
      );
    }

    const credentialAccountResult = await client.query(
      `
        SELECT id
        FROM account
        WHERE user_id = $1 AND provider_id = 'credential'
        LIMIT 1
      `,
      [userId],
    );

    const credentialAccountId = credentialAccountResult.rows[0]?.id as
      | string
      | undefined;

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
    } else if (rotatePassword) {
      await client.query(
        `
          UPDATE account
          SET password = $1, updated_at = NOW()
          WHERE id = $2
        `,
        [passwordHash, credentialAccountId],
      );
    }

    await client.query(
      `
        INSERT INTO super_admins (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
      `,
      [userId],
    );

    await client.query('COMMIT');
    console.log(
      `Seeded platform superadmin ${email} (${existingUser ? 'existing user' : 'new user'}).`,
    );
  } catch (error) {
    if (client) {
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

  if (process.argv.includes('--hash-password')) {
    await runHashPassword();
    return;
  }

  await seedSuperAdmin();
}

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (!entryPoint) {
    return false;
  }

  return import.meta.url === pathToFileURL(path.resolve(entryPoint)).href;
}

if (isMainModule()) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
