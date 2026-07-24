import { HttpApp, HttpRouter } from '@effect/platform';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Effect, Runtime, Schema } from 'effect';
import {
  CapturedRequestScopeSchema,
  captureRequestScope,
  requestScopeLayer,
  type RequestActor,
} from '../../platform/auth/request-actor';
import type { RequestContext } from '../../platform/http/request-context';
import { mcpRegistry, type McpRegistryServices } from './registry';
import { makeMcpHttpBridge } from './server';
import {
  McpInvocation,
  type McpInvocation as McpInvocationService,
} from './types';

export type McpApplicationServices = Exclude<
  McpRegistryServices,
  RequestActor | RequestContext | McpInvocationService
>;

const missingRequestScope: CallToolResult = {
  isError: true,
  content: [
    {
      type: 'text',
      text: 'Stocket could not verify the signed-in user and workspace. No action was taken.',
    },
  ],
};

export const makeMcpRouter = (
  runtime: Runtime.Runtime<McpApplicationServices>,
) => {
  const bridge = makeMcpHttpBridge({
    list: (scope, signal) =>
      Runtime.runPromise(runtime)(
        Schema.decodeUnknown(CapturedRequestScopeSchema)(scope).pipe(
          Effect.flatMap((requestScope) =>
            mcpRegistry.listAvailable.pipe(
              Effect.provide(requestScopeLayer(requestScope)),
            ),
          ),
          Effect.catchAll(() => Effect.succeed([])),
        ),
        { signal },
      ),
    execute: (scope, invocation, name, input, signal) =>
      Runtime.runPromise(runtime)(
        Schema.decodeUnknown(CapturedRequestScopeSchema)(scope).pipe(
          Effect.flatMap((requestScope) =>
            mcpRegistry
              .execute(name, input)
              .pipe(
                Effect.provideService(
                  McpInvocation,
                  invocation satisfies McpInvocationService,
                ),
                Effect.provide(requestScopeLayer(requestScope)),
              ),
          ),
          Effect.catchAll(() => Effect.succeed(missingRequestScope)),
        ),
        { signal },
      ),
  });

  const route = Effect.gen(function* () {
    const scope = yield* captureRequestScope;
    return yield* HttpApp.fromWebHandler((request) =>
      bridge.handleRequest(request, scope),
    );
  });

  return {
    router: HttpRouter.empty.pipe(
      HttpRouter.all('/', route),
      HttpRouter.prefixAll('/api/v1/mcp'),
    ),
    close: bridge.close,
  };
};
