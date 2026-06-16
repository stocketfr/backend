import { Data, Effect, Layer } from 'effect';
import { CurrentRequestContext } from '../http/request-context';
import { makeInMemoryTracer } from './in-memory-tracer';
import { makeServiceTracer } from '../observability/service-tracer';

class TestNotFound extends Data.TaggedError('TestNotFound')<{
  readonly statusCode: 404;
}> {}

class TestBadRequest extends Data.TaggedError('TestBadRequest')<{
  readonly statusCode: 400;
}> {}

class TestServerError extends Data.TaggedError('TestServerError')<{
  readonly statusCode: 500;
}> {}

class UserNotFound extends Data.TaggedError('UserNotFound')<Record<string, never>> {}

describe('makeServiceTracer', () => {
  const runWithRecorder = <A, E>(effect: Effect.Effect<A, E, never>) => {
    const { tracer, recorder } = makeInMemoryTracer();
    return Effect.runPromise(effect.pipe(Effect.withTracer(tracer))).then(
      (value) => ({ value, recorder }),
    );
  };

  it('injects module/layer/operation on spans created with `span`', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(42).pipe(trace.span('findOne')),
    );

    const span = recorder.findSpan('OrdersService.findOne');
    expect(span).toBeDefined();
    expect(span!.attributes.get('module')).toBe('orders');
    expect(span!.attributes.get('layer')).toBe('service');
    expect(span!.attributes.get('operation')).toBe('findOne');
  });

  it('injects module/layer/operation on spans created with `traced`', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const findOne = trace.traced('findOne', (id: string) =>
      Effect.succeed(id),
    );

    const { recorder } = await runWithRecorder(findOne('order-1'));

    const span = recorder.findSpan('OrdersService.findOne');
    expect(span).toBeDefined();
    expect(span!.attributes.get('module')).toBe('orders');
    expect(span!.attributes.get('layer')).toBe('service');
    expect(span!.attributes.get('operation')).toBe('findOne');
  });

  it('injects entityType when configured', async () => {
    const trace = makeServiceTracer({
      serviceName: 'UsersService',
      module: 'users',
      layer: 'service',
      entityType: 'user',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(null).pipe(trace.span('listUsers')),
    );

    const span = recorder.findSpan('UsersService.listUsers');
    expect(span!.attributes.get('entityType')).toBe('user');
  });

  it('omits entityType when not configured', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(null).pipe(trace.span('findAllPaginated')),
    );

    const span = recorder.findSpan('OrdersService.findAllPaginated');
    expect(span!.attributes.has('entityType')).toBe(false);
  });

  it('merges method-level attributes, letting method values win on collision', async () => {
    const trace = makeServiceTracer({
      serviceName: 'UsersService',
      module: 'users',
      layer: 'service',
      entityType: 'user',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(null).pipe(
        trace.span('getUser', {
          attributes: { userId: 'user-123', entityType: 'user' },
        }),
      ),
    );

    const span = recorder.findSpan('UsersService.getUser');
    expect(span!.attributes.get('userId')).toBe('user-123');
    expect(span!.attributes.get('entityType')).toBe('user');
    expect(span!.attributes.get('module')).toBe('users');
  });

  it('uses `${serviceName}.${methodName}` as the span name', async () => {
    const trace = makeServiceTracer({
      serviceName: 'AuthService',
      module: 'auth',
      layer: 'service',
      entityType: 'user',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(null).pipe(trace.span('me')),
    );

    expect(recorder.spans[0]?.name).toBe('AuthService.me');
  });

  const runMaybeFailing = <A, E>(effect: Effect.Effect<A, E, never>) => {
    const { tracer, recorder } = makeInMemoryTracer();
    return Effect.runPromiseExit(
      effect.pipe(Effect.withTracer(tracer)),
    ).then((exit) => ({ exit, recorder }));
  };

  it('sets outcome:success on a successful span', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(1).pipe(trace.span('findOne')),
    );

    expect(recorder.findSpan('OrdersService.findOne')!.attributes.get('outcome')).toBe('success');
  });

  it('maps statusCode 404 to outcome:not_found with errorType from _tag', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runMaybeFailing(
      Effect.fail(new TestNotFound({ statusCode: 404 })).pipe(
        trace.span('findOne'),
      ),
    );

    const span = recorder.findSpan('OrdersService.findOne')!;
    expect(span.attributes.get('outcome')).toBe('not_found');
    expect(span.attributes.get('errorType')).toBe('TestNotFound');
  });

  it('maps _tag ending in NotFound to outcome:not_found even without statusCode', async () => {
    const trace = makeServiceTracer({
      serviceName: 'UsersService',
      module: 'users',
      layer: 'service',
    });

    const { recorder } = await runMaybeFailing(
      Effect.fail(new UserNotFound({})).pipe(trace.span('getUser')),
    );

    const span = recorder.findSpan('UsersService.getUser')!;
    expect(span.attributes.get('outcome')).toBe('not_found');
    expect(span.attributes.get('errorType')).toBe('UserNotFound');
  });

  it('maps statusCode 400 to outcome:validation_error', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runMaybeFailing(
      Effect.fail(new TestBadRequest({ statusCode: 400 })).pipe(
        trace.span('create'),
      ),
    );

    const span = recorder.findSpan('OrdersService.create')!;
    expect(span.attributes.get('outcome')).toBe('validation_error');
    expect(span.attributes.get('errorType')).toBe('TestBadRequest');
  });

  it('maps other typed failures to outcome:failure', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runMaybeFailing(
      Effect.fail(new TestServerError({ statusCode: 500 })).pipe(
        trace.span('create'),
      ),
    );

    const span = recorder.findSpan('OrdersService.create')!;
    expect(span.attributes.get('outcome')).toBe('failure');
    expect(span.attributes.get('errorType')).toBe('TestServerError');
  });

  it('maps defects to outcome:failure with errorType:Defect', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runMaybeFailing(
      Effect.die(new Error('boom')).pipe(trace.span('create')),
    );

    const span = recorder.findSpan('OrdersService.create')!;
    expect(span.attributes.get('outcome')).toBe('failure');
    expect(span.attributes.get('errorType')).toBe('Defect');
  });

  it('does not annotate outcome/errorType on interrupts', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runMaybeFailing(
      Effect.interrupt.pipe(trace.span('findOne')),
    );

    const span = recorder.findSpan('OrdersService.findOne')!;
    expect(span.attributes.has('outcome')).toBe(false);
    expect(span.attributes.has('errorType')).toBe(false);
  });

  it('attaches requestId when CurrentRequestContext is in scope', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(1).pipe(
        trace.span('findOne'),
        Effect.provide(
          Layer.succeed(CurrentRequestContext, {
            requestId: 'req-42',
            path: '/orders/1',
            method: 'GET',
            ip: null,
            locale: 'en',
          }),
        ),
      ),
    );

    expect(recorder.findSpan('OrdersService.findOne')!.attributes.get('requestId')).toBe('req-42');
  });

  it('is a no-op for requestId when CurrentRequestContext is absent', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
    });

    const { recorder } = await runWithRecorder(
      Effect.succeed(1).pipe(trace.span('findOne')),
    );

    expect(recorder.findSpan('OrdersService.findOne')!.attributes.has('requestId')).toBe(false);
  });

  it('passes `traced` method arguments through to the attribute resolver', async () => {
    const trace = makeServiceTracer({
      serviceName: 'OrdersService',
      module: 'orders',
      layer: 'service',
      entityType: 'order',
    });

    const findOne = trace.traced(
      'findOne',
      (id: string) => Effect.succeed(id),
      (id) => ({ attributes: { orderId: id } }),
    );

    const { recorder } = await runWithRecorder(findOne('order-abc'));

    const span = recorder.findSpan('OrdersService.findOne');
    expect(span!.attributes.get('orderId')).toBe('order-abc');
    expect(span!.attributes.get('operation')).toBe('findOne');
  });
});
