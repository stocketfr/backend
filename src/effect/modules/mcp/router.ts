import { HttpApp, HttpRouter } from '@effect/platform';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Effect, Runtime, Schema } from 'effect';
import type { AuditLogWriter } from '../../platform/audit';
import type { BetterAuthService } from '../../platform/auth/better-auth';
import type { PermissionProvider } from '../../platform/auth/permission-provider';
import {
  CapturedRequestScopeSchema,
  captureRequestScope,
  requestScopeLayer,
} from '../../platform/auth/request-actor';
import type { ProductsService } from '../products/service';
import { mcpRegistry } from './registry';
import { makeMcpHttpBridge } from './server';
import {
  McpInvocation,
  type McpInvocation as McpInvocationService,
} from './types';

export type McpApplicationServices =
  | ProductsService
  | PermissionProvider
  | AuditLogWriter
  | BetterAuthService;

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
  const bridge = makeMcpHttpBridge(mcpRegistry.descriptors, {
    execute: (scope, invocation, name, input) =>
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
