import { HttpServerResponse } from '@effect/platform';
import type { HttpApp } from '@effect/platform';
import { Effect } from 'effect';
import type { AppConfigShape } from '../platform/config/app-config';

const makeSecurityHeaders = (
  appConfig: AppConfigShape,
): Record<string, string> => ({
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'x-xss-protection': '0',
  'x-dns-prefetch-control': 'off',
  'x-download-options': 'noopen',
  'x-permitted-cross-domain-policies': 'none',
  'referrer-policy': 'no-referrer',
  ...(appConfig.isProduction
    ? {
        'strict-transport-security': 'max-age=15552000; includeSubDomains',
      }
    : {}),
});

export const securityHeadersMiddleware =
  (appConfig: AppConfigShape) =>
  <E, R>(httpApp: HttpApp.Default<E, R>): HttpApp.Default<E, R> => {
    const headers = makeSecurityHeaders(appConfig);
    return Effect.map(httpApp, (response) =>
      HttpServerResponse.setHeaders(response, headers),
    );
  };
