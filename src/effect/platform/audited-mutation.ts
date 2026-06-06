import { type HttpServerResponse } from '@effect/platform';
import { Effect } from 'effect';
import type {
  AuditAction,
  AuditEntityType,
} from '@stocket/types/audit-logs';
import { AuditLogWriter } from './audit';
import { respondJson } from './errors';

type EntityIdResolver<A> = string | ((result: A) => string);

export interface AuditedMutationOptions<A, B = A> {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId: EntityIdResolver<A>;
  readonly mapResponse?: (result: A) => B;
  readonly responseOptions?: HttpServerResponse.Options.WithContentType;
}

const resolveEntityId = <A>(
  entityId: EntityIdResolver<A>,
  result: A,
): string => (typeof entityId === 'function' ? entityId(result) : entityId);

export const respondAuditedMutation = <A, E, R, B = A>(
  mutation: Effect.Effect<A, E, R>,
  options: AuditedMutationOptions<A, B>,
) =>
  Effect.gen(function* () {
    const auditLogWriter = yield* AuditLogWriter;
    const auditedMutation = mutation.pipe(
      Effect.tap((result) =>
        auditLogWriter.log({
          action: options.action,
          entityType: options.entityType,
          entityId: resolveEntityId(options.entityId, result),
        }),
      ),
      Effect.map((result) =>
        options.mapResponse ? options.mapResponse(result) : result,
      ),
    );

    return yield* respondJson(auditedMutation, options.responseOptions);
  });
