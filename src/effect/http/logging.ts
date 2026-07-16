import { Effect } from 'effect';
import type { HttpApp } from '@effect/platform';
import * as HttpServerRequest from '@effect/platform/HttpServerRequest';
import type { LogPayload } from '../platform/observability/messages';
import {
  CurrentRequestContext,
  makeRequestContext,
} from '../platform/http/request-context';

export const requestLoggingMiddleware = <E, R>(
  httpApp: HttpApp.Default<E, R>,
) =>
  Effect.flatMap(makeRequestContext, (requestContext) =>
    Effect.provideService(
      Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) => {
        const startTime = Date.now();
        const userAgent = request.headers['user-agent'] ?? 'unknown';

        return Effect.flatMap(httpApp, (response) => {
          const payload: LogPayload = {
            messageKey: 'http.request',
            requestId: requestContext.requestId,
            tenantId: requestContext.tenantId ?? '-',
            method: requestContext.method,
            path: requestContext.path,
            statusCode: response.status,
            durationMs: Date.now() - startTime,
            userAgent,
          };

          const log =
            response.status >= 500
              ? Effect.logError(payload)
              : response.status >= 400
                ? Effect.logWarning(payload)
                : Effect.log(payload);

          return Effect.as(log, response);
        });
      }),
      CurrentRequestContext,
      requestContext,
    ),
  );
