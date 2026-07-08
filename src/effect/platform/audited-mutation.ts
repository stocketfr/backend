import { type HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';
import type {
  AuditAction,
  AuditEntityType,
} from '@stocket/types/audit-logs';
import { AuditLogWriter } from './audit/index';
import { respondEmpty, respondJson } from './http/errors';

type EntityIdResolver<A> =
  | string
  | readonly string[]
  | ((result: A) => string | readonly string[]);

interface BaseAuditedMutationOptions<A> {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId: EntityIdResolver<A>;
}

interface JsonAuditedMutationOptions<A, B = A>
  extends BaseAuditedMutationOptions<A> {
  readonly response?: 'json';
  readonly mapResponse?: (result: A) => B;
  readonly responseOptions?: HttpServerResponse.Options.WithContentType;
}

interface EmptyAuditedMutationOptions<A> extends BaseAuditedMutationOptions<A> {
  readonly response: 'empty';
  readonly responseOptions?: HttpServerResponse.Options.WithContent;
}

export type AuditedMutationOptions<A, B = A> =
  | JsonAuditedMutationOptions<A, B>
  | EmptyAuditedMutationOptions<A>;

const resolveEntityIds = <A>(
  entityId: EntityIdResolver<A>,
  result: A,
): readonly string[] => {
  const resolved = typeof entityId === 'function' ? entityId(result) : entityId;
  return typeof resolved === 'string' ? [resolved] : resolved;
};

export const respondAuditedMutation = <A, E, R, B = A>(
  mutation: Effect.Effect<A, E, R>,
  options: AuditedMutationOptions<A, B>,
) =>
  Effect.gen(function* () {
    const auditLogWriter = yield* AuditLogWriter;
    const auditedMutation = mutation.pipe(
      Effect.tap((result) =>
        Effect.forEach(
          resolveEntityIds(options.entityId, result),
          (entityId) =>
            auditLogWriter.log({
              action: options.action,
              entityType: options.entityType,
              entityId,
            }),
          { discard: true },
        ),
      ),
    );

    if (options.response === 'empty') {
      return yield* respondEmpty(auditedMutation, options.responseOptions);
    }

    return yield* respondJson(
      auditedMutation.pipe(
        Effect.map((result) =>
          options.mapResponse ? options.mapResponse(result) : result,
        ),
      ),
      options.responseOptions,
    );
  });
