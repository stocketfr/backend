import * as AiTool from '@effect/ai/Tool';
import type {
  CallToolResult,
  Tool as McpToolDescriptor,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  Cause,
  Context,
  Effect,
  JSONSchema,
  Option,
  ParseResult,
  Schema,
} from 'effect';
import { isAppError } from '../../platform/effect/domain-errors';
import {
  CurrentRequestContext,
  type RequestContext,
} from '../../platform/http/request-context';
import {
  translateMessage,
  type LogPayload,
} from '../../platform/observability/messages';
import {
  McpInvocation,
  type McpConfirmationDecision,
  type McpConfirmationRequest,
  type McpToolSafety,
  type McpToolSafetyWithRequiredConfirmation,
  type McpToolSafetyWithoutConfirmation,
} from './types';

const StructuredContentSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

const toObjectJsonSchema = (
  schema: JSONSchema.JsonSchema7,
): McpToolDescriptor['inputSchema'] =>
  ToolSchema.shape.inputSchema.parse(schema);

const emptyObjectJsonSchema = (): McpToolDescriptor['inputSchema'] => ({
  type: 'object',
  properties: {},
  additionalProperties: false,
});

const toToolDescriptor = <
  const Name extends string,
  Config extends {
    readonly parameters: AiTool.AnyStructSchema;
    readonly success: Schema.Schema.Any;
    readonly failure: Schema.Schema.All;
    readonly failureMode: AiTool.FailureMode;
  },
  Requirements,
>(
  tool: AiTool.Tool<Name, Config, Requirements>,
  safety: McpToolSafety,
): McpToolDescriptor => {
  const title = Option.getOrUndefined(
    Context.getOption(tool.annotations, AiTool.Title),
  );

  return {
    name: tool.name,
    ...(title ? { title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema:
      Object.keys(tool.parametersSchema.fields).length === 0
        ? emptyObjectJsonSchema()
        : toObjectJsonSchema(
            AiTool.getJsonSchemaFromSchemaAst(tool.parametersSchema.ast),
          ),
    outputSchema: toObjectJsonSchema(JSONSchema.make(tool.successSchema)),
    annotations: {
      ...(title ? { title } : {}),
      readOnlyHint: Context.get(tool.annotations, AiTool.Readonly),
      destructiveHint: Context.get(tool.annotations, AiTool.Destructive),
      idempotentHint: Context.get(tool.annotations, AiTool.Idempotent),
      openWorldHint: Context.get(tool.annotations, AiTool.OpenWorld),
    },
    _meta: {
      'fr.stocket/safety': safety,
    },
  };
};

const firstCauseValue = <E>(cause: Cause.Cause<E>): unknown => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return failure.value;

  const defect = Cause.dieOption(cause);
  return Option.isSome(defect) ? defect.value : cause;
};

const invalidInputResult: CallToolResult = {
  isError: true,
  content: [
    {
      type: 'text',
      text: 'The action input is invalid. Check the product IDs and field values, then try again.',
    },
  ],
};

const presentToolFailure = <E>(
  cause: Cause.Cause<E>,
): Effect.Effect<CallToolResult, never, RequestContext> =>
  Effect.gen(function* () {
    const error = firstCauseValue(cause);
    const { locale, path } = yield* CurrentRequestContext;

    if (isAppError(error)) {
      const message = translateMessage(
        locale,
        error.statusCode >= 500
          ? 'errors.internalServerError'
          : error.messageKey,
        error.statusCode >= 500 ? undefined : error.messageArgs,
      );

      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Stocket could not finish this request: ${message}. Check the product's current state before retrying.`,
          },
        ],
      };
    }

    if (ParseResult.isParseError(error)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: "Stocket could not verify the action's final result. Refresh the product before trying again; the action may already have been applied.",
          },
        ],
      };
    }

    yield* Effect.logError({
      messageKey: 'http.serverError',
      statusCode: 500,
      path,
      error,
    } satisfies LogPayload);

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: "Stocket could not finish this request. Check the product's current state before trying again; the action may already have been applied.",
        },
      ],
    };
  });

export interface McpToolRegistration<R> {
  readonly descriptor: McpToolDescriptor;
  readonly execute: (input: unknown) => Effect.Effect<CallToolResult, never, R>;
}

export interface McpOutputCodec<A, R> {
  readonly encode: (
    output: A,
  ) => Effect.Effect<unknown, ParseResult.ParseError, R>;
}

export const makeMcpOutputCodec = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
): McpOutputCodec<A, R> => ({
  encode: Schema.encodeUnknown(schema),
});

const implementMcpToolCore = <
  const Name extends string,
  Parameters extends Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
  Failure extends Schema.Schema.All,
  Mode extends AiTool.FailureMode,
  ToolRequirements,
  E,
  R,
  CodecR,
>(
  tool: AiTool.Tool<
    Name,
    {
      readonly parameters: Schema.Struct<Parameters>;
      readonly success: Success;
      readonly failure: Failure;
      readonly failureMode: Mode;
    },
    ToolRequirements
  >,
  safety: McpToolSafety,
  outputCodec: McpOutputCodec<Schema.Schema.Type<Success>, CodecR>,
  handler: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
  ) => Effect.Effect<NoInfer<Schema.Schema.Type<Success>>, E, R>,
): McpToolRegistration<
  | R
  | ToolRequirements
  | Schema.Schema.Context<Schema.Struct<Parameters>>
  | CodecR
  | RequestContext
> => ({
  descriptor: toToolDescriptor(tool, safety),
  execute: (input) => {
    const decoded: Effect.Effect<
      Schema.Schema.Type<Schema.Struct<Parameters>>,
      ParseResult.ParseError,
      Schema.Schema.Context<Schema.Struct<Parameters>>
    > = Schema.decodeUnknown(tool.parametersSchema)(input);

    return decoded.pipe(
      Effect.matchCauseEffect({
        onFailure: () => Effect.succeed(invalidInputResult),
        onSuccess: (decodedInput) => {
          const handled: Effect.Effect<
            Schema.Schema.Type<Success>,
            E,
            R
          > = handler(decodedInput);
          const encoded: Effect.Effect<
            unknown,
            ParseResult.ParseError | E,
            R | CodecR
          > = Effect.flatMap(handled, outputCodec.encode);
          const structured: Effect.Effect<
            Schema.Schema.Type<typeof StructuredContentSchema>,
            ParseResult.ParseError | E,
            R | CodecR
          > = Effect.flatMap(
            encoded,
            Schema.decodeUnknown(StructuredContentSchema),
          );

          return structured.pipe(
            Effect.map(
              (structuredContent): CallToolResult => ({
                structuredContent,
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(structuredContent),
                  },
                ],
              }),
            ),
            Effect.matchCauseEffect({
              onFailure: presentToolFailure,
              onSuccess: Effect.succeed,
            }),
          );
        },
      }),
    );
  },
});

export const implementMcpTool = <
  const Name extends string,
  Parameters extends Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
  Failure extends Schema.Schema.All,
  Mode extends AiTool.FailureMode,
  ToolRequirements,
  E,
  R,
  CodecR,
>(
  tool: AiTool.Tool<
    Name,
    {
      readonly parameters: Schema.Struct<Parameters>;
      readonly success: Success;
      readonly failure: Failure;
      readonly failureMode: Mode;
    },
    ToolRequirements
  >,
  safety: McpToolSafetyWithoutConfirmation,
  outputCodec: McpOutputCodec<Schema.Schema.Type<Success>, CodecR>,
  handler: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
  ) => Effect.Effect<NoInfer<Schema.Schema.Type<Success>>, E, R>,
) => implementMcpToolCore(tool, safety, outputCodec, handler);

export interface McpConfirmationPlan<State> {
  readonly request: McpConfirmationRequest;
  readonly state: State;
}

type RejectedConfirmationDecision = Exclude<
  McpConfirmationDecision,
  'accepted'
>;

export const implementConfirmedMcpTool = <
  const Name extends string,
  Parameters extends Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
  Failure extends Schema.Schema.All,
  Mode extends AiTool.FailureMode,
  ToolRequirements,
  State,
  PrepareE,
  PrepareR,
  ExecuteE,
  ExecuteR,
  CodecR,
>(
  tool: AiTool.Tool<
    Name,
    {
      readonly parameters: Schema.Struct<Parameters>;
      readonly success: Success;
      readonly failure: Failure;
      readonly failureMode: Mode;
    },
    ToolRequirements
  >,
  safety: McpToolSafetyWithRequiredConfirmation,
  outputCodec: McpOutputCodec<Schema.Schema.Type<Success>, CodecR>,
  prepare: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
  ) => Effect.Effect<McpConfirmationPlan<State>, PrepareE, PrepareR>,
  onRejected: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
    state: State,
    decision: RejectedConfirmationDecision,
  ) => NoInfer<Schema.Schema.Type<Success>>,
  handler: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
    state: State,
  ) => Effect.Effect<NoInfer<Schema.Schema.Type<Success>>, ExecuteE, ExecuteR>,
) =>
  implementMcpToolCore(tool, safety, outputCodec, (input) =>
    Effect.gen(function* () {
      const plan = yield* prepare(input);
      const invocation = yield* McpInvocation;
      const decision = yield* invocation.requestConfirmation(plan.request);

      if (decision !== 'accepted') {
        return onRejected(input, plan.state, decision);
      }

      return yield* handler(input, plan.state);
    }),
  );

export interface McpToolRegistry<R> {
  readonly descriptors: readonly McpToolDescriptor[];
  readonly execute: (
    name: string,
    input: unknown,
  ) => Effect.Effect<CallToolResult, never, R>;
}

export const makeMcpToolRegistry = <R>(
  registrations: readonly McpToolRegistration<R>[],
): McpToolRegistry<R> => {
  const names = new Set<string>();
  for (const registration of registrations) {
    if (names.has(registration.descriptor.name)) {
      throw new Error(`Duplicate MCP tool: ${registration.descriptor.name}`);
    }
    names.add(registration.descriptor.name);
  }

  return {
    descriptors: registrations.map(({ descriptor }) => descriptor),
    execute: (name, input) => {
      const registration = registrations.find(
        ({ descriptor }) => descriptor.name === name,
      );

      return registration
        ? registration.execute(input)
        : Effect.succeed({
            isError: true,
            content: [
              { type: 'text', text: `Unknown Stocket action: ${name}` },
            ],
          });
    },
  };
};
