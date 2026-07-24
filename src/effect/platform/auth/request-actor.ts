import { Context, Effect, Layer, Option, Schema } from 'effect';
import type { UserSession } from './user-session';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../http/request-context';
import type { TenantContext } from '../tenancy/tenant-context';

export const RequestActorSchema = Schema.Struct({
  userId: Schema.String,
  tenantId: Schema.UUID,
  tenantName: Schema.String,
  tenantSlug: Schema.String,
});

export type RequestActor = Schema.Schema.Type<typeof RequestActorSchema>;

export const CurrentRequestActor = Context.GenericTag<RequestActor>(
  '@stocket/effect/platform/CurrentRequestActor',
);

export const makeRequestActor = (
  session: UserSession,
  tenant: TenantContext,
): RequestActor => ({
  userId: session.user.id,
  tenantId: tenant.tenantId,
  tenantName: tenant.tenantName,
  tenantSlug: tenant.tenantSlug,
});

const RequestContextSnapshotSchema = Schema.Struct({
  requestId: Schema.String,
  path: Schema.String,
  method: Schema.Literal(
    'GET',
    'POST',
    'PUT',
    'DELETE',
    'PATCH',
    'HEAD',
    'OPTIONS',
  ),
  ip: Schema.NullOr(Schema.String),
  locale: Schema.Literal('en', 'fr', 'de'),
  tenantId: Schema.UUID,
  tenantName: Schema.String,
  tenantSlug: Schema.String,
});

export const CapturedRequestScopeSchema = Schema.Struct({
  actor: RequestActorSchema,
  requestContext: RequestContextSnapshotSchema,
});

export type CapturedRequestScope = Schema.Schema.Type<
  typeof CapturedRequestScopeSchema
>;

export const captureRequestScope = Effect.gen(function* () {
  const actorOption = yield* Effect.serviceOption(CurrentRequestActor);
  if (Option.isNone(actorOption)) {
    return yield* Effect.dieMessage(
      'The MCP route requires an authenticated request actor',
    );
  }

  const actor = actorOption.value;
  const requestContext = yield* CurrentRequestContext;

  return {
    actor,
    requestContext: {
      requestId: requestContext.requestId,
      path: requestContext.path,
      method: requestContext.method,
      ip: requestContext.ip,
      locale: requestContext.locale,
      tenantId: actor.tenantId,
      tenantName: actor.tenantName,
      tenantSlug: actor.tenantSlug,
    },
  } satisfies CapturedRequestScope;
});

export const requestScopeLayer = (scope: CapturedRequestScope) => {
  const requestContext: RequestContext = {
    ...scope.requestContext,
    tenantId: scope.actor.tenantId,
    tenantName: scope.actor.tenantName,
    tenantSlug: scope.actor.tenantSlug,
  };

  return Layer.mergeAll(
    Layer.succeed(CurrentRequestActor, scope.actor),
    Layer.succeed(CurrentRequestContext, requestContext),
  );
};
