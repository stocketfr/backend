import { readRequiredEnv } from '@stocket/types/common';

export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function frontendOrigins(): string[] {
  const origins = parseOrigins(readRequiredEnv('FRONTEND_URL'));
  if (origins.length === 0) {
    throw new Error('FRONTEND_URL must contain at least one origin');
  }
  return origins;
}

export function firstFrontendOrigin(): string {
  return frontendOrigins()[0]!;
}

export function tryParseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
