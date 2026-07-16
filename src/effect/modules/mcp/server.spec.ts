import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapturedRequestScope } from '../../platform/auth/request-actor';
import {
  makeMcpHttpBridge,
  type McpHttpBridge,
  type McpToolExecutor,
} from './server';

const MCP_URL = 'http://stocket.stocket.fr/api/v1/mcp';
const USER_ID = '00000000-0000-4000-a000-000000000001';
const OTHER_USER_ID = '00000000-0000-4000-a000-000000000002';
const TENANT_ID = '00000000-0000-4000-a000-000000000010';
const OTHER_TENANT_ID = '00000000-0000-4000-a000-000000000020';
const PROTOCOL_VERSION = '2025-11-25';

interface RequestOptions {
  readonly sessionId?: string;
  readonly protocolVersion?: string;
  readonly url?: string;
  readonly host?: string | null;
  readonly origin?: string;
}

const tools = [
  {
    name: 'products_list',
    title: 'List products',
    description: 'Lists products in the current workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'number' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
] satisfies readonly Tool[];

const makeScope = (
  userId = USER_ID,
  tenantId = TENANT_ID,
  requestId = '00000000-0000-4000-8000-000000000099',
): CapturedRequestScope => ({
  actor: {
    userId,
    tenantId,
    tenantName: tenantId === TENANT_ID ? 'Stocket' : 'Other workspace',
    tenantSlug: tenantId === TENANT_ID ? 'stocket' : 'other-workspace',
  },
  requestContext: {
    requestId,
    path: '/api/v1/mcp',
    method: 'POST',
    ip: null,
    locale: 'en',
    tenantId,
    tenantName: tenantId === TENANT_ID ? 'Stocket' : 'Other workspace',
    tenantSlug: tenantId === TENANT_ID ? 'stocket' : 'other-workspace',
  },
});

const makePostRequest = (body: unknown, options: RequestOptions = {}) => {
  const url = options.url ?? MCP_URL;
  const headers = new Headers({
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
  });

  if (options.host !== null) {
    headers.set('host', options.host ?? new URL(url).host);
  }

  if (options.sessionId) {
    headers.set('mcp-session-id', options.sessionId);
  }
  if (options.protocolVersion) {
    headers.set('mcp-protocol-version', options.protocolVersion);
  }
  if (options.origin) {
    headers.set('origin', options.origin);
  }

  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
};

const initializeRequest = (options: RequestOptions = {}) =>
  makePostRequest(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'Stocket MCP test client', version: '1.0.0' },
      },
    },
    options,
  );

const initializedNotification = (
  sessionId: string,
  options: RequestOptions = {},
) =>
  makePostRequest(
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    { ...options, sessionId, protocolVersion: PROTOCOL_VERSION },
  );

const listToolsRequest = (sessionId?: string, options: RequestOptions = {}) =>
  makePostRequest(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    },
    { ...options, sessionId, protocolVersion: PROTOCOL_VERSION },
  );

const callToolRequest = (sessionId: string) =>
  makePostRequest(
    {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'products_list',
        arguments: { page: 2 },
      },
    },
    { sessionId, protocolVersion: PROTOCOL_VERSION },
  );

const bridges: McpHttpBridge[] = [];

const makeHarness = () => {
  const execute = vi.fn<McpToolExecutor['execute']>(
    async () =>
      ({
        content: [{ type: 'text', text: 'Products returned.' }],
      }) satisfies CallToolResult,
  );
  const bridge = makeMcpHttpBridge(tools, { execute });
  bridges.push(bridge);
  return { bridge, execute };
};

const initialize = async (
  bridge: McpHttpBridge,
  scope = makeScope(),
  options: RequestOptions = {},
) => {
  const response = await bridge.handleRequest(
    initializeRequest(options),
    scope,
  );
  const body = await response.text();
  const sessionId = response.headers.get('mcp-session-id');

  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  expect(sessionId).toBeTruthy();
  expect(body).toContain(`"protocolVersion":"${PROTOCOL_VERSION}"`);
  expect(body).toContain('"name":"stocket"');

  if (!sessionId) {
    throw new Error('Expected initialization to return an MCP session ID');
  }

  const initialized = await bridge.handleRequest(
    initializedNotification(sessionId, options),
    scope,
  );
  expect(initialized.status).toBe(202);

  return sessionId;
};

afterEach(async () => {
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
});

describe('makeMcpHttpBridge', () => {
  it('initializes a stateful session and lists the available tools', async () => {
    const { bridge, execute } = makeHarness();
    const sessionId = await initialize(bridge);

    const response = await bridge.handleRequest(
      listToolsRequest(sessionId),
      makeScope(),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('mcp-session-id')).toBe(sessionId);
    expect(body).toContain('"name":"products_list"');
    expect(body).toContain('"title":"List products"');
    expect(execute).not.toHaveBeenCalled();
  });

  it('routes tool calls with the authenticated scope from the current request', async () => {
    const { bridge, execute } = makeHarness();
    const sessionId = await initialize(bridge);
    const currentScope = makeScope(
      USER_ID,
      TENANT_ID,
      '00000000-0000-4000-8000-000000000100',
    );

    const response = await bridge.handleRequest(
      callToolRequest(sessionId),
      currentScope,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('Products returned.');
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      currentScope,
      expect.objectContaining({
        requestConfirmation: expect.any(Function),
      }),
      'products_list',
      { page: 2 },
    );
  });

  it.each([
    ['another user', makeScope(OTHER_USER_ID, TENANT_ID)],
    ['another workspace', makeScope(USER_ID, OTHER_TENANT_ID)],
  ])('rejects session reuse by %s', async (_label, otherScope) => {
    const { bridge, execute } = makeHarness();
    const sessionId = await initialize(bridge);

    const response = await bridge.handleRequest(
      callToolRequest(sessionId),
      otherScope,
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain(
      'This MCP session belongs to a different user or workspace.',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a browser request from another workspace origin', async () => {
    const { bridge, execute } = makeHarness();

    const response = await bridge.handleRequest(
      initializeRequest({ origin: 'http://other.stocket.fr' }),
      makeScope(),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.toContain(
      'MCP requests must come from the same site',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('binds a session to its original Host and effective Origin', async () => {
    const { bridge, execute } = makeHarness();
    const origin = 'http://stocket.stocket.fr';
    const sessionId = await initialize(bridge, makeScope(), { origin });

    const missingOrigin = await bridge.handleRequest(
      listToolsRequest(sessionId),
      makeScope(),
    );
    const changedHost = await bridge.handleRequest(
      listToolsRequest(sessionId, {
        url: 'http://custom.example.com/api/v1/mcp',
        host: 'custom.example.com',
        origin: 'http://custom.example.com',
      }),
      makeScope(),
    );
    const changedOrigin = await bridge.handleRequest(
      listToolsRequest(sessionId, {
        origin: 'https://stocket.stocket.fr',
      }),
      makeScope(),
    );

    expect(missingOrigin.status).toBe(200);
    expect(changedHost.status).toBe(403);
    expect(changedOrigin.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['a malformed origin', 'not an origin'],
    ['an opaque origin', 'null'],
    ['a non-HTTP origin', 'ftp://stocket.stocket.fr'],
    ['a lookalike host', 'http://stocket.stocket.fr.attacker.example'],
    ['a different port', 'http://stocket.stocket.fr:8080'],
  ])('rejects %s', async (_label, origin) => {
    const { bridge, execute } = makeHarness();

    const response = await bridge.handleRequest(
      initializeRequest({ origin }),
      makeScope(),
    );

    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a different-scheme browser origin', async () => {
    const { bridge } = makeHarness();

    const response = await bridge.handleRequest(
      initializeRequest({
        url: 'https://stocket.stocket.fr/api/v1/mcp',
        origin: 'http://stocket.stocket.fr',
      }),
      makeScope(),
    );

    expect(response.status).toBe(403);
  });

  it('rejects missing or inconsistent destination hosts', async () => {
    const { bridge } = makeHarness();

    const missingHost = await bridge.handleRequest(
      initializeRequest({ host: null }),
      makeScope(),
    );
    const inconsistentHost = await bridge.handleRequest(
      initializeRequest({ host: 'other.stocket.fr' }),
      makeScope(),
    );

    expect(missingHost.status).toBe(403);
    expect(inconsistentHost.status).toBe(403);
  });

  it('validates the site before revealing whether a session exists', async () => {
    const { bridge } = makeHarness();

    const response = await bridge.handleRequest(
      listToolsRequest('unknown-session', {
        origin: 'http://other.stocket.fr',
      }),
      makeScope(),
    );

    expect(response.status).toBe(403);
    await expect(response.text()).resolves.not.toContain('not found');
  });

  it('rejects requests with a missing or unknown session', async () => {
    const { bridge } = makeHarness();
    await initialize(bridge);

    const missing = await bridge.handleRequest(listToolsRequest(), makeScope());
    const unknown = await bridge.handleRequest(
      listToolsRequest('unknown-session'),
      makeScope(),
    );

    expect(missing.status).toBe(400);
    await expect(missing.text()).resolves.toContain(
      'Initialize the MCP session before calling Stocket tools.',
    );
    expect(unknown.status).toBe(404);
    await expect(unknown.text()).resolves.toContain(
      'MCP session not found or expired.',
    );
  });

  it('invalidates active sessions when the bridge closes', async () => {
    const { bridge } = makeHarness();
    const sessionId = await initialize(bridge);

    await bridge.close();

    const response = await bridge.handleRequest(
      listToolsRequest(sessionId),
      makeScope(),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toContain(
      'MCP session not found or expired.',
    );
  });
});
