import type { HttpServerRequest } from '@effect/platform';
import { Context, Effect, Layer, Option } from 'effect';
import {
  type AuditAction,
  type AuditEntityType,
} from '@stocket/types/audit-logs';
import { DrizzleDatabase } from '../db/drizzle';
import type { BetterAuthService } from '../auth/better-auth';
import { auditLogs } from '../db/schema';
import type { LogPayload } from '../observability/messages';
import { getOptionalSession } from '../http/session';
import { getRequestContext } from '../http/request-context';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-constants';
import { CurrentRequestActor } from '../auth/request-actor';

export interface AuditWriteParams {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
}

export interface AuditLogWriter {
  readonly log: (
    params: AuditWriteParams,
  ) => Effect.Effect<
    void,
    never,
    BetterAuthService | HttpServerRequest.HttpServerRequest
  >;
}

export const AuditLogWriter = Context.GenericTag<AuditLogWriter>(
  '@stocket/effect/platform/AuditLogWriter',
);

export const makeAuditLogWriter = Effect.gen(function* () {
  const db = yield* DrizzleDatabase;

  const writeAuditLog = (params: AuditWriteParams) =>
    Effect.gen(function* () {
      const actor = yield* Effect.serviceOption(CurrentRequestActor);
      const session = Option.isSome(actor) ? null : yield* getOptionalSession;
      const requestContext = yield* getRequestContext;

      yield* Effect.tryPromise({
        try: () =>
          db.insert(auditLogs).values({
            tenant_id: Option.isSome(actor)
              ? actor.value.tenantId
              : (requestContext.tenantId ?? DEFAULT_TENANT_ID),
            user_id: Option.isSome(actor)
              ? actor.value.userId
              : (session?.user.id ?? null),
            action: params.action,
            entity_type: params.entityType,
            entity_id: params.entityId,
            changes: null,
            ip_address: requestContext.ip ?? null,
            user_agent: null,
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.catchAll((cause) =>
          Effect.logError({
            messageKey: 'audit.writeFailed',
            action: params.action,
            entityType: params.entityType,
            entityId: params.entityId,
            cause,
          } satisfies LogPayload),
        ),
        Effect.asVoid,
      );
    });

  return {
    log: (params) =>
      Effect.gen(function* () {
        yield* Effect.forkDaemon(writeAuditLog(params));
      }).pipe(Effect.asVoid),
  } satisfies AuditLogWriter;
});

export const auditLayer = Layer.effect(AuditLogWriter, makeAuditLogWriter);
