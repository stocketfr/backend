import { HttpServerRequest } from '@effect/platform';
import { Context, Effect, Layer, Option } from 'effect';
import {
  type AuditAction,
  type AuditEntityType,
} from '@stocket/types/audit-logs';
import { DrizzleDatabase } from '../db/drizzle';
import { BetterAuth } from '../auth/better-auth';
import { auditLogs } from '../db/schema';
import type { LogPayload } from '../observability/messages';
import { getOptionalSession } from '../http/session';
import { getOptionalRequestContext } from '../http/request-context';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-constants';
import { CurrentRequestActor } from '../auth/request-actor';

export interface AuditWriteParams {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId: string;
}

export interface AuditLogWriter {
  readonly log: (params: AuditWriteParams) => Effect.Effect<void>;
}

export const AuditLogWriter = Context.GenericTag<AuditLogWriter>(
  '@stocket/effect/platform/AuditLogWriter',
);

export const makeAuditLogWriter = Effect.gen(function* () {
  const db = yield* DrizzleDatabase;

  const writeAuditLog = (params: AuditWriteParams) =>
    Effect.gen(function* () {
      const actor = yield* Effect.serviceOption(CurrentRequestActor);
      const session = Option.isSome(actor)
        ? null
        : yield* Effect.gen(function* () {
            const betterAuth = yield* Effect.serviceOption(BetterAuth);
            const request = yield* Effect.serviceOption(
              HttpServerRequest.HttpServerRequest,
            );
            if (Option.isNone(betterAuth) || Option.isNone(request)) {
              return null;
            }
            return yield* getOptionalSession.pipe(
              Effect.provideService(BetterAuth, betterAuth.value),
              Effect.provideService(
                HttpServerRequest.HttpServerRequest,
                request.value,
              ),
            );
          });
      const requestContext = yield* getOptionalRequestContext;

      yield* Effect.tryPromise({
        try: () =>
          db.insert(auditLogs).values({
            tenant_id: Option.isSome(actor)
              ? actor.value.tenantId
              : Option.match(requestContext, {
                  onNone: () => DEFAULT_TENANT_ID,
                  onSome: (context) => context.tenantId ?? DEFAULT_TENANT_ID,
                }),
            user_id: Option.isSome(actor)
              ? actor.value.userId
              : (session?.user.id ?? null),
            action: params.action,
            entity_type: params.entityType,
            entity_id: params.entityId,
            changes: null,
            ip_address: Option.match(requestContext, {
              onNone: () => null,
              onSome: (context) => context.ip,
            }),
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
