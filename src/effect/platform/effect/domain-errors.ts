import { Data } from 'effect';
import {
  type ErrorCode,
  errorCodeForHttpStatus,
  isErrorCode,
} from '@stocket/types/common';
import {
  DEFAULT_LOCALE,
  translateMessage,
  type AnyMessageKey,
  type MessageArgs,
} from '../observability/messages';

interface AppErrorInputFields {
  readonly messageKey: AnyMessageKey;
  readonly messageArgs?: MessageArgs;
  readonly code?: ErrorCode;
}

interface AppErrorFields extends AppErrorInputFields {
  readonly message: string;
}

type AppErrorInstance<
  Tag extends string,
  StatusCode extends number,
  Fields extends object = object,
> = AppError<Tag, StatusCode> & Readonly<Fields>;

type AppErrorConstructor<
  Tag extends string,
  StatusCode extends number,
  BaseFields extends object = AppErrorInputFields,
> = new <Fields extends object = object>(
  args: Readonly<Fields & BaseFields>,
) => AppErrorInstance<Tag, StatusCode, Fields & BaseFields>;

/**
 * Convention for Effect domain errors in this codebase:
 *
 * - Every domain error extends Data.TaggedError with a unique _tag
 * - Every error carries a `messageKey` and `statusCode` (HTTP mapping)
 * - The `runEffect` bridge reads these to produce the correct HTTP error response
 *
 * Usage:
 *   class ProductNotFound extends NotFoundError("ProductNotFound")<{ readonly id: string }> {}
 *   yield* new ProductNotFound({ id, messageKey: "products.notFound" })
 */

export interface AppError<
  Tag extends string = string,
  StatusCode extends number = number,
> extends Error {
  readonly _tag: Tag;
  readonly message: string;
  readonly messageKey: AnyMessageKey;
  readonly messageArgs?: MessageArgs;
  readonly code: ErrorCode;
  readonly statusCode: StatusCode;
}

const isUnknownRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const isAppError = (value: unknown): value is AppError =>
  isUnknownRecord(value) &&
  typeof value._tag === 'string' &&
  typeof value.messageKey === 'string' &&
  isErrorCode(value.code) &&
  typeof value.statusCode === 'number';

function makeErrorFactory<StatusCode extends number>(statusCode: StatusCode) {
  return <Tag extends string>(
    tag: Tag,
    defaultCode: ErrorCode = errorCodeForHttpStatus(statusCode),
  ): AppErrorConstructor<Tag, StatusCode> => {
    class EffectError extends Data.TaggedError(tag)<AppErrorFields> {
      readonly statusCode: StatusCode = statusCode;

      constructor(args: Readonly<object & AppErrorInputFields>) {
        super({
          ...args,
          code: args.code ?? defaultCode,
          message: translateMessage(
            DEFAULT_LOCALE,
            args.messageKey,
            args.messageArgs,
          ),
        });
      }
    }

    return EffectError as AppErrorConstructor<Tag, StatusCode>;
  };
}

export const NotFoundError = makeErrorFactory(404);
export const BadRequestError = makeErrorFactory(400);
export const ConflictError = makeErrorFactory(409);
export const ForbiddenError = makeErrorFactory(403);
export const UnauthorizedError = makeErrorFactory(401);
export const InternalError = makeErrorFactory(500);
export const NotImplementedError = makeErrorFactory(501);
