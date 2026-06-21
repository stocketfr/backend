/**
 * Shared database connection utilities for Drizzle and Better Auth pg Pool.
 */

import { readOptionalEnv, readRequiredEnv } from './env.utils';

export function getSSLConfig(): { rejectUnauthorized: boolean } | false {
  const rejectUnauthorized =
    (readOptionalEnv('DB_SSL_REJECT_UNAUTHORIZED') ?? 'true').toLowerCase() ===
    'true';
  return readOptionalEnv('DB_SSL') === 'true' ? { rejectUnauthorized } : false;
}

export function getPoolMax(): number {
  const poolMax = Number.parseInt(readOptionalEnv('DB_POOL_MAX') ?? '20', 10);
  if (Number.isNaN(poolMax) || poolMax <= 0) {
    throw new Error('DB_POOL_MAX must be a positive integer');
  }
  return poolMax;
}

export const IDLE_TIMEOUT_MS = 30000;

/**
 * Returns the shared database URL from environment variables.
 * Used by Better Auth, Drizzle, and backend scripts.
 */
export function getDatabaseUrl(): string {
  return readRequiredEnv('DATABASE_URL');
}
