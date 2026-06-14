import { Cause, Effect, Option, type Tracer } from 'effect';
import { CurrentRequestContext } from '../request-context';

type AnyEffect = Effect.Effect<any, any, any>;

export type TraceModule =
  | 'auth'
  | 'categories'
  | 'clients'
  | 'health'
  | 'locations'
  | 'notifications'
  | 'orders'
  | 'superadmin'
  | 'suppliers'
  | 'users';
export type TraceLayer = 'service';
export type TraceEntityType = 'user' | 'order' | 'tenant';
export type TraceOutcome =
  | 'success'
  | 'not_found'
  | 'validation_error'
  | 'failure';

export interface TraceAttributeCatalog {
  readonly categoryId: string;
  readonly clientId: string;
  readonly entityId: string;
  readonly entityType: TraceEntityType;
  readonly errorType: string;
  readonly id: string;
  readonly layer: TraceLayer;
  readonly locationId: string;
  readonly module: TraceModule;
  readonly operation: string;
  readonly orderId: string;
  readonly outcome: TraceOutcome;
  readonly parentId: string;
  readonly productId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly userId: string;
}

export type TraceAttributes = Partial<TraceAttributeCatalog>;

export type TraceSpanOptions = Omit<
  Tracer.SpanOptions,
  'attributes' | 'captureStackTrace'
> & {
  readonly attributes?: TraceAttributes;
};

type ServiceMethodSpanResolver<Args extends Array<any>> =
  | TraceSpanOptions
  | ((...args: Args) => TraceSpanOptions | undefined);

export interface ServiceTracerConfig {
  readonly serviceName: string;
  readonly module: TraceModule;
  readonly layer: TraceLayer;
  readonly entityType?: TraceEntityType;
}

interface CauseClassification {
  readonly outcome: TraceOutcome;
  readonly errorType: string;
}

const classifyCause = (
  cause: Cause.Cause<unknown>,
): CauseClassification | undefined => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) {
    const error = failure.value as {
      readonly _tag?: string;
      readonly statusCode?: number;
    };
    const errorType = error._tag ?? 'UnknownError';
    const statusCode = error.statusCode;
    if (statusCode === 404 || errorType.endsWith('NotFound')) {
      return { outcome: 'not_found', errorType };
    }
    if (statusCode === 400) {
      return { outcome: 'validation_error', errorType };
    }
    return { outcome: 'failure', errorType };
  }

  if (Option.isSome(Cause.dieOption(cause))) {
    return { outcome: 'failure', errorType: 'Defect' };
  }

  return undefined;
};

const attachRequestId = Effect.flatMap(
  Effect.serviceOption(CurrentRequestContext),
  Option.match({
    onNone: () => Effect.void,
    onSome: (ctx) =>
      Effect.annotateCurrentSpan({
        requestId: ctx.requestId,
        ...(ctx.tenantId ? { tenantId: ctx.tenantId } : {}),
      }),
  }),
);

const withAttribution = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  attachRequestId.pipe(
    Effect.andThen(() =>
      effect.pipe(
        Effect.tap(() => Effect.annotateCurrentSpan({ outcome: 'success' })),
        Effect.tapErrorCause((cause) => {
          const classification = classifyCause(cause);
          return classification
            ? Effect.annotateCurrentSpan({
                outcome: classification.outcome,
                errorType: classification.errorType,
              })
            : Effect.void;
        }),
      ),
    ),
  );

export const makeServiceTracer = (config: ServiceTracerConfig) => {
  const { serviceName, module, layer, entityType } = config;

  const mergeAttributes = (
    methodName: string,
    methodAttributes: TraceAttributes | undefined,
  ): TraceAttributes => ({
    module,
    layer,
    operation: methodName,
    ...(entityType !== undefined ? { entityType } : {}),
    ...methodAttributes,
  });

  const span =
    (methodName: string, options?: TraceSpanOptions) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      withAttribution(effect).pipe(
        Effect.withSpan(`${serviceName}.${methodName}`, {
          ...options,
          attributes: mergeAttributes(methodName, options?.attributes),
        }),
      );

  const traced = <Args extends Array<any>, Ret extends AnyEffect>(
    methodName: string,
    body: (...args: Args) => Ret,
    options?: ServiceMethodSpanResolver<Args>,
  ) =>
    Effect.functionWithSpan({
      body: (...args: Args) => withAttribution(body(...args)) as Ret,
      options: (...args) => {
        const resolved =
          typeof options === 'function' ? options(...args) : options;
        return {
          name: `${serviceName}.${methodName}`,
          ...resolved,
          attributes: mergeAttributes(methodName, resolved?.attributes),
        };
      },
    });

  return { span, traced };
};
