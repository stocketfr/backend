import { HttpRouter, HttpServerRequest } from '@effect/platform';
import { Effect } from 'effect';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { findTenantByHostname } from '../../platform/db/tenant-queries';
import { AppConfig } from '../../platform/config/app-config';
import { respondEmpty } from '../../platform/http/errors';
import { isPlatformHost, normalizeHost } from '../../platform/tenancy/host';
import {
  TenantHostNotFound,
  TenantNotResolved,
} from '../../platform/tenancy/tenant-context';

const getSearchParam = (url: string, key: string) => {
  try {
    return new URL(url, 'http://localhost').searchParams.get(key);
  } catch {
    return null;
  }
};

const allowTlsDomain = (domain: string | null | undefined) =>
  Effect.gen(function* () {
    const hostname = normalizeHost(domain);
    const verifiedHostname = yield* Effect.filterOrFail(
      Effect.succeed(hostname),
      (value): value is string => Boolean(value),
      () =>
        new TenantHostNotFound({
          host: hostname,
          messageKey: 'tenant.hostNotFound',
        }),
    );

    if (isPlatformHost(verifiedHostname)) {
      return;
    }

    const db = yield* DrizzleDatabase;
    const appConfig = yield* AppConfig;
    const rows = yield* Effect.tryPromise({
      try: () => findTenantByHostname(db, verifiedHostname, appConfig),
      catch: (cause) =>
        new TenantNotResolved({
          cause,
          messageKey: 'tenant.notResolved',
        }),
    });

    yield* Effect.filterOrFail(
      Effect.succeed(rows[0]),
      Boolean,
      () =>
        new TenantHostNotFound({
          host: verifiedHostname,
          messageKey: 'tenant.hostNotFound',
        }),
    );
  });

export const platformRouter = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/tls/ask',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      return yield* respondEmpty(
        allowTlsDomain(getSearchParam(request.url, 'domain')),
      );
    }),
  ),
  HttpRouter.prefixAll('/platform'),
);
