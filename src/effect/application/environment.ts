export const APPLICATION_NODE_ENVS = [
  'development',
  'staging',
  'production',
] as const;

export type ApplicationNodeEnv = (typeof APPLICATION_NODE_ENVS)[number];

const applicationNodeEnvSet: ReadonlySet<string> = new Set(
  APPLICATION_NODE_ENVS,
);

export const isApplicationNodeEnv = (
  value: string,
): value is ApplicationNodeEnv => applicationNodeEnvSet.has(value);

const isConfigured = (value: string | undefined): value is string =>
  value !== undefined && value.trim().length > 0;

const normalizeHostname = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

  if (!normalized.includes(':')) return normalized;

  try {
    return new URL(`http://[${normalized}]/`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return normalized;
  }
};

const isLocalHostname = (value: string): boolean => {
  const hostname = normalizeHostname(value);
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.startsWith('/') ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname === '::1' ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname) ||
    /^::(?:ffff:)?7f[0-9a-f]{2}:/.test(hostname)
  );
};

const parseUrl = (name: string, value: string): URL => {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${name} must contain valid URLs in production`);
  }
};

const assertProductionUrls = (
  name: string,
  values: readonly string[],
  requireHttps: boolean,
) => {
  for (const entry of values) {
    const url = parseUrl(name, entry);
    if (
      isLocalHostname(url.hostname) ||
      (requireHttps && url.protocol !== 'https:')
    ) {
      throw new Error(
        `${name} must not contain local or insecure URLs in production`,
      );
    }
  }
};

const configuredValue = (value: string | undefined): readonly string[] =>
  isConfigured(value) ? [value.trim()] : [];

const configuredList = (value: string | undefined): readonly string[] =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0) ?? [];

const decodeUrlComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const lastSearchParameter = (url: URL | null, name: string): string =>
  url?.searchParams.getAll(name).at(-1) ?? '';

export const assertSafeApplicationEnvironment = (
  nodeEnv: ApplicationNodeEnv,
  env: NodeJS.ProcessEnv,
): void => {
  if (nodeEnv !== 'production') return;

  assertProductionUrls('CORS_ORIGIN', configuredList(env.CORS_ORIGIN), true);
  assertProductionUrls('FRONTEND_URL', configuredList(env.FRONTEND_URL), true);
  assertProductionUrls(
    'BETTER_AUTH_URL',
    configuredValue(env.BETTER_AUTH_URL),
    true,
  );
  assertProductionUrls('S3_ENDPOINT', configuredValue(env.S3_ENDPOINT), true);

  const databaseUrl = isConfigured(env.DATABASE_URL)
    ? parseUrl('DATABASE_URL', env.DATABASE_URL)
    : null;
  const databaseHost =
    lastSearchParameter(databaseUrl, 'host') ||
    databaseUrl?.hostname ||
    env.PGHOST ||
    'localhost';
  if (databaseHost.split(',').some(isLocalHostname)) {
    throw new Error('DATABASE_URL must not use a local host in production');
  }

  const databaseUser = decodeUrlComponent(
    lastSearchParameter(databaseUrl, 'user') ||
      databaseUrl?.username ||
      env.PGUSER ||
      '',
  );
  const databasePassword = decodeUrlComponent(
    lastSearchParameter(databaseUrl, 'password') ||
      databaseUrl?.password ||
      env.PGPASSWORD ||
      '',
  );
  if (databaseUser === 'postgres' && databasePassword === 'postgres') {
    throw new Error(
      'DATABASE_URL must not use the development postgres credentials in production',
    );
  }

  if (
    env.S3_ACCESS_KEY_ID === 'minio' ||
    env.S3_SECRET_ACCESS_KEY === 'minio123'
  ) {
    throw new Error(
      'S3 credentials must not use the development MinIO credentials in production',
    );
  }

  if (isConfigured(env.E2E_SEED_SECRET) || isConfigured(env.E2E_DATABASE_URL)) {
    throw new Error('E2E controls must not be configured in production');
  }

  if (
    isConfigured(env.VITEST) &&
    ['true', 'yes', 'on', '1'].includes(env.VITEST.trim().toLowerCase())
  ) {
    throw new Error('VITEST must not be enabled in production');
  }
};

export const parseApplicationPort = (value: string): number => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
};
