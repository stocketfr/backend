import { Headers, HttpServerRequest } from '@effect/platform';
import type { HttpMethod } from '@effect/platform/HttpMethod';
import { Context, Effect, Option } from 'effect';
import { v4 as uuidv4, validate as uuidValidate } from 'uuid';
import { resolveLocale, type SupportedLocale } from '../messages';

export interface RequestContext {
  readonly requestId: string;
  readonly path: string;
  readonly method: HttpMethod;
  readonly ip: string | null;
  readonly locale: SupportedLocale;
  tenantId?: string;
  tenantName?: string;
  tenantSlug?: string;
}

export const CurrentRequestContext = Context.GenericTag<RequestContext>(
  '@stocket/effect/platform/CurrentRequestContext',
);

const fromRequest = (
  request: HttpServerRequest.HttpServerRequest,
): RequestContext => {
  const headerValue = Headers.get(request.headers, 'x-request-id');

  const requestId =
    Option.isSome(headerValue) && uuidValidate(headerValue.value)
      ? headerValue.value
      : uuidv4();
  const { url } = request;
  const queryStart = url.indexOf('?');
  const path = queryStart >= 0 ? url.slice(0, queryStart) : url;
  const locale = resolveLocale(
    Option.getOrNull(Headers.get(request.headers, 'accept-language')),
  );

  return {
    requestId,
    path,
    method: request.method,
    ip: Option.getOrNull(request.remoteAddress),
    locale,
  };
};

export const makeRequestContext = Effect.map(
  HttpServerRequest.HttpServerRequest,
  fromRequest,
);

export const getRequestContext = Effect.flatMap(
  Effect.serviceOption(CurrentRequestContext),
  Option.match({
    onNone: () => makeRequestContext,
    onSome: Effect.succeed,
  }),
);

/**
 * Like `getRequestContext`, but resolves to `Option.none` instead of dying
 * when neither a `CurrentRequestContext` nor an `HttpServerRequest` is in
 * scope — for callers (background fibers, scripts) that merely prefer
 * request-derived data when it exists.
 */
export const getOptionalRequestContext: Effect.Effect<
  Option.Option<RequestContext>
> = Effect.gen(function* () {
  const current = yield* Effect.serviceOption(CurrentRequestContext);
  if (Option.isSome(current)) {
    return current;
  }
  const request = yield* Effect.serviceOption(
    HttpServerRequest.HttpServerRequest,
  );
  return Option.map(request, fromRequest);
});
