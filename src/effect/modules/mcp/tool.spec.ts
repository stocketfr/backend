import { Tool } from '@effect/ai';
import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Exit, Fiber, Layer, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import {
  PermissionProvider,
  type UserPermissions,
} from '../../platform/auth/permission-provider';
import {
  CurrentRequestActor,
  type RequestActor,
} from '../../platform/auth/request-actor';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { makeTestLayer } from '../../testing/utils';
import {
  composeMcpRegistry,
  defineConfirmedMcpCommand,
  defineMcpCommand,
  defineMcpFeature,
  defineMcpQuery,
  makeMcpToolRegistry,
} from './tool';
import { McpInvocation } from './types';

const requestContextLayer = Layer.succeed(CurrentRequestContext, {
  requestId: '00000000-0000-4000-8000-000000000201',
  path: '/api/v1/mcp',
  method: 'POST',
  ip: null,
  locale: 'en',
});

const policy = {
  kind: 'query',
  confirmation: 'never',
  effect: 'Test-only action.',
} as const;

const access = {
  permissions: [{ resource: Resource.PRODUCTS, permission: Permission.READ }],
} as const;

const actor: RequestActor = {
  userId: '00000000-0000-4000-8000-000000000301',
  tenantId: '00000000-0000-4000-8000-000000000302',
  tenantName: 'Test workspace',
  tenantSlug: 'test-workspace',
};

const accessLayer = (...grants: Permission[]) => {
  const snapshot: UserPermissions = {
    roleNames: ['test-role'],
    permissions: { [Resource.PRODUCTS]: grants },
  };
  return Layer.mergeAll(
    Layer.succeed(CurrentRequestActor, actor),
    makeTestLayer(PermissionProvider)({
      getPermissionsForUser: () => Effect.succeed(snapshot),
    }),
  );
};

const makeReadonlyTool = (name: string) =>
  Tool.make(name, {
    success: Schema.Struct({ ok: Schema.Boolean }),
    failure: Schema.Unknown,
  })
    .annotate(Tool.Title, name)
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false);

const makeCommandTool = (name: string) =>
  Tool.make(name, {
    success: Schema.Struct({ ok: Schema.Boolean }),
    failure: Schema.Unknown,
  })
    .annotate(Tool.Title, name)
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false);

describe('Effect MCP tool adapter', () => {
  it.effect('encodes transformed success values for structuredContent', () => {
    const Output = Schema.Struct({
      happened_at: Schema.DateFromString,
    });
    const TestTool = Tool.make('test_transformed_output', {
      success: Output,
      failure: Schema.Unknown,
    });
    const registration = defineMcpQuery({
      tool: TestTool,
      access,
      policy,
      run: () =>
        Effect.succeed({
          happened_at: new Date('2026-07-15T12:00:00.000Z'),
        }),
    });

    return Effect.gen(function* () {
      const result = yield* registration
        .execute({})
        .pipe(Effect.provide(requestContextLayer));

      expect(result.isError).not.toBe(true);
      expect(registration.descriptor.inputSchema).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      });
      expect(result.structuredContent).toEqual({
        happened_at: '2026-07-15T12:00:00.000Z',
      });
    });
  });

  it.effect(
    'rejects handler output that violates the advertised schema',
    () => {
      const Output = Schema.Struct({
        affected: Schema.Number.pipe(Schema.positive()),
      });
      const TestTool = Tool.make('test_invalid_output', {
        success: Output,
        failure: Schema.Unknown,
      });
      const registration = defineMcpQuery({
        tool: TestTool,
        access,
        policy,
        run: () => Effect.succeed({ affected: -1 }),
      });

      return Effect.gen(function* () {
        const result = yield* registration
          .execute({})
          .pipe(Effect.provide(requestContextLayer));

        expect(result.isError).toBe(true);
        expect(result.structuredContent).toBeUndefined();
        expect(JSON.stringify(result.content)).toContain(
          'the action may already have been applied',
        );
      });
    },
  );

  it.effect('reports invalid input separately from an uncertain result', () => {
    const Output = Schema.Struct({ ok: Schema.Boolean });
    const TestTool = Tool.make('test_invalid_input', {
      parameters: { id: Schema.UUID },
      success: Output,
      failure: Schema.Unknown,
    });
    const registration = defineMcpQuery({
      tool: TestTool,
      access,
      policy,
      run: () => Effect.succeed({ ok: true }),
    });

    return Effect.gen(function* () {
      const result = yield* registration
        .execute({ id: 'not-a-uuid' })
        .pipe(Effect.provide(requestContextLayer));

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        'The action input is invalid',
      );
      expect(JSON.stringify(result.content)).not.toContain(
        'may already have been applied',
      );
    });
  });

  it.effect(
    'returns a controlled error when a tool exceeds its timeout',
    () => {
      const registration = defineMcpQuery({
        tool: makeReadonlyTool('test_timeout'),
        access,
        policy,
        timeoutMilliseconds: 0,
        run: () => Effect.never,
      });

      return Effect.gen(function* () {
        const result = yield* registration
          .execute({})
          .pipe(Effect.provide(requestContextLayer));

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(
          'The action took too long and was stopped',
        );
        expect(result._meta).toEqual({
          'fr.stocket/error': {
            code: 'tool_timeout',
            retryable: true,
          },
        });
      });
    },
  );

  it.effect('preserves interruption instead of returning a tool error', () => {
    const registration = defineMcpQuery({
      tool: makeReadonlyTool('test_interrupt'),
      access,
      policy,
      run: () => Effect.never,
    });

    return Effect.gen(function* () {
      const fiber = yield* registration
        .execute({})
        .pipe(Effect.provide(requestContextLayer), Effect.fork);
      const exit = yield* Fiber.interrupt(fiber);

      expect(Exit.isInterrupted(exit)).toBe(true);
    });
  });

  it.effect('does not count the human confirmation wait as tool work', () => {
    const registration = defineConfirmedMcpCommand({
      tool: makeCommandTool('test_confirm'),
      access,
      policy: {
        kind: 'command',
        confirmation: 'required',
        effect: 'Changes test data after confirmation.',
        reversible: 'yes',
        undoTool: 'test_confirm',
      },
      timeoutMilliseconds: 1,
      prepare: () =>
        Effect.succeed({
          request: { message: 'Proceed?', confirmLabel: 'Proceed' },
          state: undefined,
        }),
      onRejected: () => ({ ok: false }),
      run: () => Effect.succeed({ ok: true }),
    });
    const layer = Layer.mergeAll(
      accessLayer(Permission.READ),
      requestContextLayer,
      Layer.succeed(McpInvocation, {
        requestConfirmation: () =>
          Effect.promise(
            () =>
              new Promise<'accepted'>((resolve) =>
                setTimeout(() => resolve('accepted'), 10),
              ),
          ),
      }),
    );

    return Effect.gen(function* () {
      const result = yield* registration
        .execute({})
        .pipe(Effect.provide(layer));

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ ok: true });
    });
  });

  it.effect(
    'filters discovery and invocation through the same access policy',
    () => {
      const readHandler = vi.fn(() => Effect.succeed({ ok: true }));
      const writeHandler = vi.fn(() => Effect.succeed({ ok: true }));
      const readRegistration = defineMcpQuery({
        tool: makeReadonlyTool('test_read'),
        access: {
          permissions: [
            { resource: Resource.PRODUCTS, permission: Permission.READ },
          ],
        },
        policy,
        run: readHandler,
      });
      const writeRegistration = defineMcpQuery({
        tool: makeReadonlyTool('test_write'),
        access: {
          permissions: [
            { resource: Resource.PRODUCTS, permission: Permission.WRITE },
          ],
        },
        policy,
        run: writeHandler,
      });
      const registry = makeMcpToolRegistry([
        readRegistration,
        writeRegistration,
      ]);
      const layer = Layer.merge(
        accessLayer(Permission.READ),
        requestContextLayer,
      );

      return Effect.gen(function* () {
        const available = yield* registry.listAvailable.pipe(
          Effect.provide(layer),
        );
        const denied = yield* registry
          .execute('test_write', {})
          .pipe(Effect.provide(layer));

        expect(available.map(({ name }) => name)).toEqual(['test_read']);
        expect(denied.isError).toBe(true);
        expect(JSON.stringify(denied.content)).toContain(
          'This action is not available',
        );
        expect(readHandler).not.toHaveBeenCalled();
        expect(writeHandler).not.toHaveBeenCalled();
      });
    },
  );

  it('builds a stable manifest with feature metadata', () => {
    const registration = defineMcpQuery({
      tool: makeReadonlyTool('test_read'),
      access,
      policy,
      run: () => Effect.succeed({ ok: true }),
    });
    const registry = composeMcpRegistry(
      defineMcpFeature({
        domain: 'test',
        contractVersion: 2,
        registrations: [registration],
      }),
    );

    expect(JSON.parse(JSON.stringify(registry.manifest))).toMatchObject({
      schemaVersion: 1,
      tools: [
        {
          name: 'test_read',
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
          },
          _meta: {
            'fr.stocket/safety': policy,
            'fr.stocket/tool': {
              domain: 'test',
              intent: 'read',
              contractVersion: 2,
            },
          },
        },
      ],
    });
  });

  it('rejects invalid contracts when the registry is composed', () => {
    const query = defineMcpQuery({
      tool: makeReadonlyTool('test_read'),
      access,
      policy,
      run: () => Effect.succeed({ ok: true }),
    });
    const missingAccess = defineMcpQuery({
      tool: makeReadonlyTool('test_open'),
      access: { permissions: [] },
      policy,
      run: () => Effect.succeed({ ok: true }),
    });
    const missingUndo = defineMcpCommand({
      tool: makeCommandTool('test_write'),
      access,
      policy: {
        kind: 'command',
        confirmation: 'never',
        effect: 'Writes test data.',
        reversible: 'yes',
        undoTool: 'test_missing',
      },
      run: () => Effect.succeed({ ok: true }),
    });
    const reversibleWithoutUndo = defineMcpCommand({
      tool: makeCommandTool('test_change'),
      access,
      policy: {
        kind: 'command',
        confirmation: 'never',
        effect: 'Changes test data.',
        reversible: 'best-effort',
      },
      run: () => Effect.succeed({ ok: true }),
    });

    expect(() => makeMcpToolRegistry([query, query])).toThrow(
      'Duplicate MCP tool: test_read',
    );
    expect(() => makeMcpToolRegistry([missingAccess])).toThrow(
      'must declare at least one permission',
    );
    expect(() => makeMcpToolRegistry([missingUndo])).toThrow(
      'references missing undo tool test_missing',
    );
    expect(() => makeMcpToolRegistry([reversibleWithoutUndo])).toThrow(
      'must declare an undo tool',
    );
    expect(() =>
      defineMcpFeature({
        domain: 'products',
        contractVersion: 1,
        registrations: [query],
      }),
    ).toThrow('must start with its feature domain products_');
  });
});
