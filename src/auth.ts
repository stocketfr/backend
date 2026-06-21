import { betterAuth } from 'better-auth';
import { admin, organization } from 'better-auth/plugins';
import { Pool } from 'pg';
import { getCrossSubDomainCookieConfig } from './auth-cookie-domain';
import { makeAuthEmailHooks } from './email/auth';
import { defaultMailer } from './email/default-mailer';
import {
  getSSLConfig,
  getPoolMax,
  IDLE_TIMEOUT_MS,
  getDatabaseUrl,
} from './config/db-connection.utils';
import { frontendOrigins } from './config/frontend-url.utils';
import { readRequiredEnv } from './config/env.utils';
import {
  getTenantBaseDomain,
  isPlatformHost,
  normalizeHost,
} from './effect/platform/tenancy/host';

const normalizeForwardedProto = (proto: string | null | undefined) => {
  const normalizedProto = proto?.split(',')[0]?.trim().toLowerCase() || 'https';
  return normalizedProto === 'http' || normalizedProto === 'https'
    ? normalizedProto
    : null;
};

const localTenantHostCandidates = (hostname: string) => {
  if (
    process.env.NODE_ENV === 'production' ||
    !hostname.endsWith('.localhost')
  ) {
    return [hostname];
  }

  return [hostname, `${hostname}:3000`];
};

const isLocalRuntime = () =>
  process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'staging';

const tenantTrustedOriginPatterns = () => [
  `https://*.${getTenantBaseDomain()}`,
  ...(isLocalRuntime()
    ? ['http://*.localhost:3000', 'https://*.localhost:3000']
    : []),
];

async function isTrustedAuthHost(host: string | null | undefined) {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return false;
  if (isPlatformHost(normalizedHost)) return true;

  try {
    const result = await pool.query(
      `
        SELECT 1
        FROM tenant_domains
        WHERE hostname = ANY($1::text[]) AND verified_at IS NOT NULL
        LIMIT 1
      `,
      [localTenantHostCandidates(normalizedHost)],
    );

    return result.rowCount !== null && result.rowCount > 0;
  } catch {
    return false;
  }
}

async function originFromUrl(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return (await isTrustedAuthHost(url.host)) ? url.origin : null;
  } catch {
    return null;
  }
}

async function originFromForwardedHost(
  host: string | null | undefined,
  proto: string | null | undefined,
) {
  const normalizedHost = normalizeHost(host);
  const normalizedProto = normalizeForwardedProto(proto);
  if (!normalizedHost || !normalizedProto) return null;

  return (await isTrustedAuthHost(normalizedHost))
    ? `${normalizedProto}://${normalizedHost}`
    : null;
}

const betterAuthSecret = readRequiredEnv('BETTER_AUTH_SECRET');
const betterAuthUrl = readRequiredEnv('BETTER_AUTH_URL');
const ssl = getSSLConfig();
const poolMax = getPoolMax();
const databaseUrl = getDatabaseUrl();

const pool = new Pool({
  connectionString: databaseUrl,
  ssl,
  max: poolMax,
  idleTimeoutMillis: IDLE_TIMEOUT_MS,
});

const configuredFrontendOrigins = frontendOrigins();
const configuredTrustedOrigins = [
  ...configuredFrontendOrigins,
  ...tenantTrustedOriginPatterns(),
];
const crossSubDomainCookies = getCrossSubDomainCookieConfig({
  authBaseUrl: betterAuthUrl,
  frontendOrigins: configuredFrontendOrigins,
  cookieDomain: process.env.BETTER_AUTH_COOKIE_DOMAIN,
});
const trustedOrigins = async (request?: Request): Promise<string[]> => {
  const dynamicOrigins = await Promise.all([
    originFromUrl(request?.headers.get('origin')),
    originFromUrl(request?.headers.get('referer')),
    originFromForwardedHost(
      request?.headers.get('x-forwarded-host') ?? request?.headers.get('host'),
      request?.headers.get('x-forwarded-proto'),
    ),
  ]);

  return [
    ...configuredTrustedOrigins,
    ...dynamicOrigins.filter((origin): origin is string => origin !== null),
  ];
};

const coreAuthSchema = {
  user: {
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    // Notification locale is optional so existing accounts remain valid.
    additionalFields: {
      locale: { type: 'string', required: false, input: true },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
    },
  },
  account: {
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
} as const;

const adminSchema = {
  user: {
    fields: {
      banReason: 'ban_reason',
      banExpires: 'ban_expires',
    },
  },
  session: {
    fields: {
      impersonatedBy: 'impersonated_by',
    },
  },
} as const;

const organizationSchema = {
  organization: {
    fields: {
      createdAt: 'created_at',
    },
  },
  member: {
    fields: {
      organizationId: 'organization_id',
      userId: 'user_id',
      createdAt: 'created_at',
    },
  },
  invitation: {
    fields: {
      organizationId: 'organization_id',
      inviterId: 'inviter_id',
      expiresAt: 'expires_at',
      createdAt: 'created_at',
    },
  },
  session: {
    fields: {
      activeOrganizationId: 'active_organization_id',
    },
  },
} as const;

// Better Auth defaults to camelCase column names. The rest of the codebase uses
// snake_case (Drizzle schema, hand-written SQL in this file and in repositories,
// and the committed migrations). Map every camelCase field Better Auth knows
// about to its snake_case column so a single naming convention holds end-to-end.
const authEmails = makeAuthEmailHooks(defaultMailer);

export const auth = betterAuth({
  secret: betterAuthSecret,
  baseURL: betterAuthUrl,
  trustedOrigins,
  database: pool,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: authEmails.sendResetPassword,
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendVerificationEmail: authEmails.sendVerificationEmail,
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: 60 * 60 * 24,
  },
  ...coreAuthSchema,
  rateLimit: {
    enabled: true,
    window: 60,
    max: 500,
    customRules: {
      '/sign-in/email': { window: 60, max: 10 },
      '/sign-up/email': { window: 60, max: 5 },
      '/request-password-reset': { window: 60, max: 5 },
      '/send-verification-email': { window: 60, max: 3 },
      '/reset-password': { window: 60, max: 10 },
    },
  },
  plugins: [
    admin({
      schema: adminSchema,
    }),
    organization({
      allowUserToCreateOrganization: false,
      schema: organizationSchema,
    }),
  ],
  advanced: {
    database: {
      generateId: 'uuid',
    },
    ...(crossSubDomainCookies ? { crossSubDomainCookies } : {}),
  },
});
