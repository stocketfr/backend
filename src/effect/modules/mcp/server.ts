import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
  type CallToolResult,
  type ServerNotification,
  type ServerRequest,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Effect, Schema } from 'effect';
import type { CapturedRequestScope } from '../../platform/auth/request-actor';
import type { McpConfirmationDecision, McpInvocation } from './types';

const DEFAULT_SESSION_IDLE_MILLISECONDS = 30 * 60 * 1_000;
const DEFAULT_SESSION_CLEANUP_INTERVAL_MILLISECONDS = 60 * 1_000;
const DEFAULT_MAX_SESSIONS_PER_PRINCIPAL = 5;
const DEFAULT_MAX_SESSIONS = 500;

const ConfirmationContentSchema = Schema.Struct({
  confirm: Schema.Boolean,
});

type ToolHandlerExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export interface McpToolExecutor {
  readonly list: (
    scope: unknown,
    signal: AbortSignal,
  ) => Promise<readonly Tool[]>;
  readonly execute: (
    scope: unknown,
    invocation: McpInvocation,
    name: string,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<CallToolResult>;
}

export interface McpHttpBridgeOptions {
  readonly sessionIdleMilliseconds?: number;
  readonly cleanupIntervalMilliseconds?: number;
  readonly maxSessionsPerPrincipal?: number;
  readonly maxSessions?: number;
  readonly now?: () => number;
}

interface SessionPrincipal {
  readonly userId: string;
  readonly tenantId: string;
}

interface RequestBinding {
  readonly targetHost: string;
  readonly effectiveOrigin: string;
}

interface SessionEntry {
  readonly server: Server;
  readonly transport: WebStandardStreamableHTTPServerTransport;
  readonly principal: SessionPrincipal;
  readonly requestBinding: RequestBinding;
  lastSeenAt: number;
}

const samePrincipal = (left: SessionPrincipal, right: SessionPrincipal) =>
  left.userId === right.userId && left.tenantId === right.tenantId;

const sameRequestBinding = (left: RequestBinding, right: RequestBinding) =>
  left.targetHost === right.targetHost &&
  left.effectiveOrigin === right.effectiveOrigin;

const principalFromScope = (scope: CapturedRequestScope): SessionPrincipal => ({
  userId: scope.actor.userId,
  tenantId: scope.actor.tenantId,
});

const toAuthInfo = (scope: CapturedRequestScope): AuthInfo => ({
  // Better Auth has already authenticated this request. This internal adapter
  // deliberately does not copy the real session token into the MCP SDK.
  token: 'stocket-internal-session',
  clientId: 'stocket-web',
  scopes: [],
  extra: { requestScope: scope },
});

const jsonRpcError = (
  status: number,
  code: number,
  message: string,
): Response =>
  Response.json(
    {
      jsonrpc: '2.0',
      id: null,
      error: { code, message },
    },
    { status },
  );

type RequestBindingResult =
  | { readonly binding: RequestBinding; readonly response?: never }
  | { readonly binding?: never; readonly response: Response };

const invalidRequestBinding = () =>
  jsonRpcError(
    403,
    -32003,
    'MCP requests must come from the same site as their destination.',
  );

const validateRequestBinding = (request: Request): RequestBindingResult => {
  const requestUrl = new URL(request.url);
  const rawHost = request.headers.get('host');
  if (
    !rawHost ||
    (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:')
  ) {
    return { response: invalidRequestBinding() };
  }

  let targetHost: string;
  try {
    const hostUrl = new URL(`${requestUrl.protocol}//${rawHost}`);
    if (
      !hostUrl.hostname ||
      hostUrl.username.length > 0 ||
      hostUrl.password.length > 0 ||
      hostUrl.pathname !== '/' ||
      hostUrl.search.length > 0 ||
      hostUrl.hash.length > 0
    ) {
      return { response: invalidRequestBinding() };
    }
    targetHost = hostUrl.host;
  } catch {
    return { response: invalidRequestBinding() };
  }

  if (targetHost !== requestUrl.host) {
    return { response: invalidRequestBinding() };
  }

  const originHeader = request.headers.get('origin');
  if (!originHeader) {
    return {
      binding: {
        targetHost,
        effectiveOrigin: requestUrl.origin,
      },
    };
  }

  try {
    const originUrl = new URL(originHeader);
    if (
      (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') ||
      originUrl.username.length > 0 ||
      originUrl.password.length > 0 ||
      originHeader !== originUrl.origin ||
      originUrl.origin !== requestUrl.origin
    ) {
      return { response: invalidRequestBinding() };
    }

    return {
      binding: {
        targetHost,
        effectiveOrigin: originUrl.origin,
      },
    };
  } catch {
    return { response: invalidRequestBinding() };
  }
};

const requestConfirmation = (
  server: Server,
  extra: ToolHandlerExtra,
  message: string,
  confirmLabel: string,
): Effect.Effect<McpConfirmationDecision> =>
  Effect.tryPromise({
    try: async (signal) => {
      const result = await server.elicitInput(
        {
          mode: 'form',
          message,
          requestedSchema: {
            type: 'object',
            properties: {
              confirm: {
                type: 'boolean',
                title: confirmLabel,
              },
            },
            required: ['confirm'],
          },
        },
        {
          relatedRequestId: extra.requestId,
          signal: AbortSignal.any([extra.signal, signal]),
        },
      );

      if (result.action !== 'accept') {
        return 'declined' as const;
      }

      const content = await Schema.decodeUnknownPromise(
        ConfirmationContentSchema,
      )(result.content);
      return content.confirm ? ('accepted' as const) : ('declined' as const);
    },
    catch: () => 'unavailable' as const,
  }).pipe(Effect.catchAll((decision) => Effect.succeed(decision)));

const makeInvocation = (
  server: Server,
  extra: ToolHandlerExtra,
): McpInvocation => ({
  requestConfirmation: ({ message, confirmLabel }) =>
    requestConfirmation(server, extra, message, confirmLabel),
});

const makeSessionServer = (executor: McpToolExecutor) => {
  const server = new Server(
    { name: 'stocket', version: '0.1.0' },
    {
      capabilities: { tools: {} },
      enforceStrictCapabilities: true,
      instructions:
        'Use the Stocket tools to help the signed-in user manage only their current workspace. Never invent IDs. Tools whose Stocket safety policy requires confirmation must use the server-enforced confirmation flow. Mutation results include undo guidance when available.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async (_request, extra) => ({
    tools: [
      ...(await executor.list(
        extra.authInfo?.extra?.requestScope,
        extra.signal,
      )),
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) =>
    executor.execute(
      extra.authInfo?.extra?.requestScope,
      makeInvocation(server, extra),
      request.params.name,
      request.params.arguments ?? {},
      extra.signal,
    ),
  );

  return server;
};

export interface McpHttpBridge {
  readonly handleRequest: (
    request: Request,
    scope: CapturedRequestScope,
  ) => Promise<Response>;
  readonly close: () => Promise<void>;
}

export const makeMcpHttpBridge = (
  executor: McpToolExecutor,
  options: McpHttpBridgeOptions = {},
): McpHttpBridge => {
  const sessions = new Map<string, SessionEntry>();
  const pendingSessionsByPrincipal = new Map<string, number>();
  const sessionIdleMilliseconds =
    options.sessionIdleMilliseconds ?? DEFAULT_SESSION_IDLE_MILLISECONDS;
  const cleanupIntervalMilliseconds =
    options.cleanupIntervalMilliseconds ??
    DEFAULT_SESSION_CLEANUP_INTERVAL_MILLISECONDS;
  const maxSessionsPerPrincipal =
    options.maxSessionsPerPrincipal ?? DEFAULT_MAX_SESSIONS_PER_PRINCIPAL;
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const now = options.now ?? Date.now;
  let pendingSessionCount = 0;

  const principalKey = ({ userId, tenantId }: SessionPrincipal) =>
    JSON.stringify([tenantId, userId]);

  const closeEntry = async (entry: SessionEntry) => {
    await Promise.allSettled([entry.server.close(), entry.transport.close()]);
  };

  const closeExpiredSessions = async () => {
    const expiresBefore = now() - sessionIdleMilliseconds;
    const expired = [...sessions.entries()].filter(
      ([, entry]) => entry.lastSeenAt <= expiresBefore,
    );

    await Promise.allSettled(
      expired.map(async ([sessionId, entry]) => {
        sessions.delete(sessionId);
        await closeEntry(entry);
      }),
    );
  };

  const cleanupTimer = setInterval(() => {
    void closeExpiredSessions();
  }, cleanupIntervalMilliseconds);
  cleanupTimer.unref();

  const reserveSession = (principal: SessionPrincipal) => {
    const key = principalKey(principal);
    const activeForPrincipal = [...sessions.values()].filter((entry) =>
      samePrincipal(entry.principal, principal),
    ).length;
    const pendingForPrincipal = pendingSessionsByPrincipal.get(key) ?? 0;

    if (
      sessions.size + pendingSessionCount >= maxSessions ||
      activeForPrincipal + pendingForPrincipal >= maxSessionsPerPrincipal
    ) {
      return false;
    }

    pendingSessionCount += 1;
    pendingSessionsByPrincipal.set(key, pendingForPrincipal + 1);
    return true;
  };

  const releaseSessionReservation = (principal: SessionPrincipal) => {
    const key = principalKey(principal);
    const pendingForPrincipal = pendingSessionsByPrincipal.get(key) ?? 0;
    pendingSessionCount -= 1;
    if (pendingForPrincipal <= 1) {
      pendingSessionsByPrincipal.delete(key);
    } else {
      pendingSessionsByPrincipal.set(key, pendingForPrincipal - 1);
    }
  };

  const startSession = async (
    request: Request,
    scope: CapturedRequestScope,
    requestBinding: RequestBinding,
  ): Promise<Response> => {
    let parsedBody: unknown;
    try {
      parsedBody = await request.clone().json();
    } catch {
      return jsonRpcError(400, -32700, 'Parse error: invalid JSON');
    }

    if (!isInitializeRequest(parsedBody)) {
      return jsonRpcError(
        400,
        -32000,
        'Initialize the MCP session before calling Stocket tools.',
      );
    }

    const principal = principalFromScope(scope);
    if (!reserveSession(principal)) {
      return jsonRpcError(
        429,
        -32002,
        'Too many active MCP sessions. Close an existing session or try again later.',
      );
    }

    const server = makeSessionServer(executor);
    const rawHost = request.headers.get('host');
    const rawOrigin = request.headers.get('origin');
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, entry);
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
      },
      allowedHosts: [...new Set([rawHost, requestBinding.targetHost])].filter(
        (host): host is string => host !== null,
      ),
      allowedOrigins: [
        ...new Set([rawOrigin, requestBinding.effectiveOrigin]),
      ].filter((origin): origin is string => origin !== null),
      enableDnsRebindingProtection: true,
    });
    const entry: SessionEntry = {
      server,
      transport,
      principal,
      requestBinding,
      lastSeenAt: now(),
    };

    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, {
        parsedBody,
        authInfo: toAuthInfo(scope),
      });

      if (!transport.sessionId) {
        await closeEntry(entry);
      }

      return response;
    } catch {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
      await closeEntry(entry);
      return jsonRpcError(500, -32603, 'Could not start the MCP session.');
    } finally {
      releaseSessionReservation(principal);
    }
  };

  const handleExistingSession = async (
    request: Request,
    scope: CapturedRequestScope,
    sessionId: string,
    requestBinding: RequestBinding,
  ): Promise<Response> => {
    const entry = sessions.get(sessionId);
    if (!entry) {
      return jsonRpcError(404, -32001, 'MCP session not found or expired.');
    }

    if (!samePrincipal(entry.principal, principalFromScope(scope))) {
      return jsonRpcError(
        403,
        -32003,
        'This MCP session belongs to a different user or workspace.',
      );
    }

    if (!sameRequestBinding(entry.requestBinding, requestBinding)) {
      return invalidRequestBinding();
    }

    entry.lastSeenAt = now();
    try {
      return await entry.transport.handleRequest(request, {
        authInfo: toAuthInfo(scope),
      });
    } catch {
      return jsonRpcError(500, -32603, 'MCP request failed.');
    }
  };

  return {
    handleRequest: async (request, scope) => {
      await closeExpiredSessions();
      const bindingResult = validateRequestBinding(request);
      if (bindingResult.response) return bindingResult.response;

      const sessionId = request.headers.get('mcp-session-id');

      if (sessionId) {
        return handleExistingSession(
          request,
          scope,
          sessionId,
          bindingResult.binding,
        );
      }

      if (request.method !== 'POST') {
        return jsonRpcError(
          400,
          -32000,
          'Mcp-Session-Id is required after initialization.',
        );
      }

      return startSession(request, scope, bindingResult.binding);
    },
    close: async () => {
      clearInterval(cleanupTimer);
      const entries = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(entries.map(closeEntry));
    },
  };
};
