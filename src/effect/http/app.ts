import {
  HttpApp,
  HttpApiBuilder,
  HttpApiSwagger,
  HttpRouter,
  HttpServerResponse,
} from '@effect/platform';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import { Effect, Layer, Option } from 'effect';
import { auth } from '../../auth';
import { apiRouter } from '../modules';
import { HealthService } from '../modules/health/service';
import { HealthApiLive } from '../modules/health/router';
import { respondCause } from '../platform/http/errors';
import {
  resolveLocale,
  translateMessage,
  type AnyMessageKey,
  type MessageArgs,
} from '../platform/observability/messages';
import { corsMiddleware } from './cors';
import { securityHeadersMiddleware } from './security-headers';
import { requestLoggingMiddleware } from './logging';
import { AppApi } from './api';
import { tenantContextMiddleware } from './tenant';

const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

const stripQueryString = (url: string) => {
  const queryIndex = url.indexOf('?');
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
};

const makeErrorResponse = (
  statusCode: number,
  error: string,
  messageKey: AnyMessageKey,
  path: string,
  locale: ReturnType<typeof resolveLocale>,
  messageArgs?: MessageArgs,
  headers?: Record<string, string>,
) =>
  HttpServerResponse.unsafeJson(
    {
      statusCode,
      error,
      messageKey,
      ...(messageArgs ? { messageArgs } : {}),
      message: translateMessage(locale, messageKey, messageArgs),
      path,
      timestamp: new Date().toISOString(),
    },
    {
      status: statusCode,
      headers,
    },
  );

const bodyLimitMiddleware = <E, R>(httpApp: HttpApp.Default<E, R>) =>
  Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
    const contentLengthHeader = request.headers['content-length'];
    const contentLength =
      typeof contentLengthHeader === 'string'
        ? Number.parseInt(contentLengthHeader, 10)
        : Number.NaN;

    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_REQUEST_BODY_BYTES
    ) {
      const acceptLanguageHeader = request.headers['accept-language'];
      const locale = resolveLocale(
        typeof acceptLanguageHeader === 'string' ? acceptLanguageHeader : null,
      );

      return Effect.succeed(
        makeErrorResponse(
          413,
          'Payload Too Large',
          'http.requestBodyTooLarge',
          stripQueryString(request.url),
          locale,
        ),
      );
    }

    return HttpServerRequest.withMaxBodySize(
      httpApp,
      Option.some(MAX_REQUEST_BODY_BYTES),
    );
  });

const makeApiBuilderApp = (healthService: HealthService) => {
  const healthLayer = Layer.succeed(HealthService, healthService);
  const apiLayer = Layer.provide(HttpApiBuilder.api(AppApi), [
    HealthApiLive.pipe(Layer.provide(healthLayer)),
  ]);

  return HttpApiBuilder.httpApp.pipe(
    Effect.provide(
      Layer.mergeAll(
        apiLayer,
        HttpApiSwagger.layer({ path: '/docs' }).pipe(Layer.provide(apiLayer)),
        HttpApiBuilder.Router.Live,
        HttpApiBuilder.Middleware.layer,
      ),
    ),
  );
};

const betterAuthHandler = (request: Request): Promise<Response> => {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/auth')) {
    return auth.handler(request);
  }

  url.pathname = `/api/auth${url.pathname}`;
  return auth.handler(new Request(url, request));
};

export const buildHttpApp = Effect.gen(function* () {
  // Build the HttpApiBuilder app once. HealthService is in scope from the
  // applicationLayer provided in main.ts. The resulting HttpApp serves both
  // the typed API routes and the Swagger UI at /docs.
  const healthService = yield* HealthService;
  const builderApp = yield* makeApiBuilderApp(healthService);

  const appRouter = HttpRouter.empty.pipe(
    // Health routes handled by HttpApiBuilder (typed, schema-validated)
    HttpRouter.mountApp('/health-check', builderApp, { includePrefix: true }),
    // Swagger UI served from the same HttpApi builder app
    HttpRouter.mountApp('/docs', builderApp, { includePrefix: true }),
    // Legacy routes remain on HttpRouter until migrated
    HttpRouter.mountApp(
      '/api/auth',
      HttpApp.fromWebHandler(betterAuthHandler),
      {
        includePrefix: true,
      },
    ),
    HttpRouter.concat(apiRouter),
    HttpRouter.catchAllCause(respondCause),
  );

  const base = yield* HttpRouter.toHttpApp(appRouter).pipe(
    Effect.map((app) => app.pipe(Effect.catchAllCause(respondCause))),
  );

  return requestLoggingMiddleware(
    securityHeadersMiddleware(
      corsMiddleware(bodyLimitMiddleware(tenantContextMiddleware(base))),
    ),
  ).pipe(Effect.catchAllCause(respondCause));
});
