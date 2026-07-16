import { Tool } from '@effect/ai';
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Schema } from 'effect';
import { CurrentRequestContext } from '../../platform/http/request-context';
import { implementMcpTool, makeMcpOutputCodec } from './tool';

const requestContextLayer = Layer.succeed(CurrentRequestContext, {
  requestId: '00000000-0000-4000-8000-000000000201',
  path: '/api/v1/mcp',
  method: 'POST',
  ip: null,
  locale: 'en',
});

const safety = {
  confirmation: 'never',
  effect: 'Test-only action.',
  reversible: 'yes',
} as const;

describe('Effect MCP tool adapter', () => {
  it.effect('encodes transformed success values for structuredContent', () => {
    const Output = Schema.Struct({
      happened_at: Schema.DateFromString,
    });
    const TestTool = Tool.make('test_transformed_output', {
      success: Output,
      failure: Schema.Unknown,
    });
    const registration = implementMcpTool(
      TestTool,
      safety,
      makeMcpOutputCodec(TestTool.successSchema),
      () =>
        Effect.succeed({
          happened_at: new Date('2026-07-15T12:00:00.000Z'),
        }),
    );

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
      const registration = implementMcpTool(
        TestTool,
        safety,
        makeMcpOutputCodec(TestTool.successSchema),
        () => Effect.succeed({ affected: -1 }),
      );

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
    const registration = implementMcpTool(
      TestTool,
      safety,
      makeMcpOutputCodec(TestTool.successSchema),
      () => Effect.succeed({ ok: true }),
    );

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
});
