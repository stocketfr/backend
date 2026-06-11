export function parseOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function firstFrontendOrigin(): string {
  return parseOrigins(process.env.FRONTEND_URL)[0] ?? 'http://localhost:3000';
}

export function tryParseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
