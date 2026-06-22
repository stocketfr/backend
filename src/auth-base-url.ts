const AUTH_BASE_PATH = '/api/auth';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function normalizeBetterAuthBaseUrl(value: string): string {
  const trimmed = trimTrailingSlashes(value);
  const url = new URL(trimmed);
  const pathname = trimTrailingSlashes(url.pathname) || '/';

  if (pathname === '/' || pathname === '/api') {
    url.pathname = AUTH_BASE_PATH;
    return trimTrailingSlashes(url.toString());
  }

  return trimmed;
}
