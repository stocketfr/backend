import { HttpServerError, HttpServerResponse } from '@effect/platform';
import { Effect, Cause, ParseResult } from 'effect';
import { TreeFormatter } from 'effect/ParseResult';
import {
  type ErrorCode,
  errorCodeForHttpStatus,
  isErrorCode,
} from '@stocket/types/common';
import { AppConfig, type AppConfigShape } from '../config/app-config';
import { isAppError } from '../effect/domain-errors';
import { getRequestContext } from './request-context';
import {
  localizeMessageTree,
  translateMessage,
  type AnyMessageKey,
  type LogPayload,
  type MessageArgs,
} from '../observability/messages';

const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const getStatusName = (statusCode: number) =>
  STATUS_NAMES[statusCode] ?? 'Internal Server Error';

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const messageFromUnknown = (value: unknown, fallback: string): string => {
  if (value instanceof Error && value.message.trim() !== '') {
    return value.message;
  }

  if (
    isUnknownRecord(value) &&
    typeof value.message === 'string' &&
    value.message.trim() !== ''
  ) {
    return value.message;
  }

  return fallback;
};

const withRequestIdHeader = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.map(getRequestContext, ({ requestId }) =>
    HttpServerResponse.setHeader(response, 'x-request-id', requestId),
  );

const makeErrorEnvelope = (
  statusCode: number,
  error: string,
  code: ErrorCode,
  messageKey: AnyMessageKey,
  path: string,
  locale: Parameters<typeof translateMessage>[0],
  messageArgs?: MessageArgs,
) => ({
  statusCode,
  error,
  code,
  messageKey,
  ...(messageArgs ? { messageArgs } : {}),
  message: translateMessage(locale, messageKey, messageArgs),
  path,
  timestamp: new Date().toISOString(),
});

const getFirstError = <E>(cause: Cause.Cause<E>): unknown => {
  const failureOption = Cause.failureOption(cause);
  if (failureOption._tag === 'Some') {
    return failureOption.value;
  }

  const defectOption = Cause.dieOption(cause);
  if (defectOption._tag === 'Some') {
    return defectOption.value;
  }

  return cause;
};

const toErrorDetails = (
  error: unknown,
  path: string,
  appConfig: AppConfigShape,
): {
  statusCode: number;
  error: string;
  code: ErrorCode;
  messageKey: AnyMessageKey;
  messageArgs?: MessageArgs;
} => {
  if (isAppError(error)) {
    const isMasked = appConfig.isProduction && error.statusCode >= 500;

    return {
      statusCode: error.statusCode,
      error: getStatusName(error.statusCode),
      code: isErrorCode(error.code)
        ? error.code
        : errorCodeForHttpStatus(error.statusCode),
      messageKey: isMasked ? 'errors.internalServerError' : error.messageKey,
      ...(isMasked || !error.messageArgs
        ? {}
        : { messageArgs: error.messageArgs }),
    };
  }

  if (ParseResult.isParseError(error)) {
    return {
      statusCode: 400,
      error: getStatusName(400),
      code: errorCodeForHttpStatus(400),
      messageKey: 'http.parseError',
      messageArgs: { details: TreeFormatter.formatErrorSync(error) },
    };
  }

  if (error instanceof HttpServerError.RouteNotFound) {
    return {
      statusCode: 404,
      error: getStatusName(404),
      code: errorCodeForHttpStatus(404),
      messageKey: 'http.routeNotFound',
      messageArgs: { method: error.request.method, path },
    };
  }

  if (isUnknownRecord(error) && error._tag === 'MultipartError') {
    return {
      statusCode: 400,
      error: getStatusName(400),
      code: errorCodeForHttpStatus(400),
      messageKey: 'http.requestError',
      messageArgs: {
        details: messageFromUnknown(error, 'Invalid multipart body'),
      },
    };
  }

  if (error instanceof HttpServerError.RequestError) {
    return {
      statusCode: 400,
      error: getStatusName(400),
      code: errorCodeForHttpStatus(400),
      messageKey: 'http.requestError',
      messageArgs: {
        details: error.description ?? error.message,
      },
    };
  }

  const unexpectedMessage = messageFromUnknown(error, '');
  if (unexpectedMessage) {
    if (appConfig.isProduction) {
      return {
        statusCode: 500,
        error: getStatusName(500),
        code: errorCodeForHttpStatus(500),
        messageKey: 'errors.internalServerError',
      };
    }

    return {
      statusCode: 500,
      error: getStatusName(500),
      code: errorCodeForHttpStatus(500),
      messageKey: 'http.unexpectedError',
      messageArgs: { details: unexpectedMessage },
    };
  }

  return {
    statusCode: 500,
    error: getStatusName(500),
    code: errorCodeForHttpStatus(500),
    messageKey: 'errors.internalServerError',
  };
};

export const respondCause = <E>(cause: Cause.Cause<E>) =>
  Effect.gen(function* () {
    const appConfig = yield* AppConfig;
    const { path, locale } = yield* getRequestContext;
    const firstError = getFirstError(cause);
    const details = toErrorDetails(firstError, path, appConfig);

    if (details.statusCode >= 500) {
      yield* Effect.logError({
        messageKey: 'http.serverError',
        statusCode: details.statusCode,
        path,
        error: firstError,
      } satisfies LogPayload);
    }

    const response = HttpServerResponse.unsafeJson(
      makeErrorEnvelope(
        details.statusCode,
        details.error,
        details.code,
        details.messageKey,
        path,
        locale,
        details.messageArgs,
      ),
      { status: details.statusCode },
    );

    return yield* withRequestIdHeader(response);
  }).pipe(Effect.provide(AppConfig.Default));

export const respondJson = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: HttpServerResponse.Options.WithContentType,
) =>
  Effect.gen(function* () {
    const body = yield* effect;
    const { locale } = yield* getRequestContext;
    return yield* HttpServerResponse.json(
      localizeMessageTree(body, locale),
      options,
    );
  }).pipe(
    Effect.catchAllCause(respondCause),
    Effect.flatMap(withRequestIdHeader),
  );

export const respondJsonOk = <A>(
  body: A,
  options?: HttpServerResponse.Options.WithContentType,
) => respondJson(Effect.succeed(body), options);

export const respondEmpty = <E, R>(
  effect: Effect.Effect<unknown, E, R>,
  options?: HttpServerResponse.Options.WithContent,
) =>
  effect.pipe(
    Effect.as(HttpServerResponse.empty(options)),
    Effect.catchAllCause(respondCause),
    Effect.flatMap(withRequestIdHeader),
  );
