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
  type McpCommandPolicyWithRequiredConfirmation,
  type McpCommandPolicyWithoutConfirmation,
  type McpQueryPolicy,
  type McpToolPolicy,
} from './types';
import {
  type McpAccessRequirements,
  type McpToolAccess,
  isMcpToolAllowed,
  loadMcpAccessSnapshot,
  requireMcpToolAccess,
} from './access';
import { McpToolTimeout } from './mcp.errors';

const DEFAULT_TOOL_TIMEOUT_MILLISECONDS = 30_000;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

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
  policy: McpToolPolicy,
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
      'fr.stocket/safety': policy,
    },
  };
};

const firstCauseValue = <E>(cause: Cause.Cause<E>): unknown => {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return failure.value;

  const defect = Cause.dieOption(cause);
  return Option.isSome(defect) ? defect.value : cause;
};

const makeToolErrorResult = (
  text: string,
  code: string,
  retryable: boolean,
  details?: string,
): CallToolResult => ({
  isError: true,
  content: [{ type: 'text', text: details ? `${text}\n${details}` : text }],
  _meta: {
    'fr.stocket/error': {
      code,
      retryable,
    },
  },
});

const presentUnavailableTool: Effect.Effect<
  CallToolResult,
  never,
  RequestContext
> = Effect.map(CurrentRequestContext, ({ locale }) =>
  makeToolErrorResult(
    translateMessage(locale, 'mcp.actionUnavailable'),
    'action_unavailable',
    false,
  ),
);

const presentInvalidInput = (
  error: ParseResult.ParseError,
): Effect.Effect<CallToolResult, never, RequestContext> =>
  Effect.map(CurrentRequestContext, ({ locale }) =>
    makeToolErrorResult(
      translateMessage(locale, 'mcp.invalidInput'),
      'invalid_input',
      false,
      ParseResult.TreeFormatter.formatErrorSync(error).slice(0, 1_000),
    ),
  );

const presentToolFailure = <E>(
  cause: Cause.Cause<E>,
): Effect.Effect<CallToolResult, never, RequestContext> =>
  Effect.gen(function* () {
    const error = firstCauseValue(cause);
    const { locale, path } = yield* CurrentRequestContext;

    if (error instanceof McpToolTimeout) {
      return makeToolErrorResult(
        translateMessage(locale, 'mcp.toolTimedOut'),
        'tool_timeout',
        true,
      );
    }

    if (isAppError(error)) {
      const message = translateMessage(
        locale,
        error.statusCode >= 500
          ? 'errors.internalServerError'
          : error.messageKey,
        error.statusCode >= 500 ? undefined : error.messageArgs,
      );

      return {
        ...makeToolErrorResult(
          `${translateMessage(locale, 'mcp.requestFailed')} ${message}`,
          error._tag,
          error.statusCode === 429 || error.statusCode >= 500,
        ),
      };
    }

    if (ParseResult.isParseError(error)) {
      return makeToolErrorResult(
        translateMessage(locale, 'mcp.invalidResult'),
        'invalid_result',
        false,
      );
    }

    yield* Effect.logError({
      messageKey: 'http.serverError',
      statusCode: 500,
      path,
      error,
    } satisfies LogPayload);

    return makeToolErrorResult(
      translateMessage(locale, 'mcp.requestFailed'),
      'internal_error',
      true,
    );
  });

export interface McpToolRegistration<R> {
  readonly descriptor: McpToolDescriptor;
  readonly access: McpToolAccess;
  readonly policy: McpToolPolicy;
  readonly execute: (input: unknown) => Effect.Effect<CallToolResult, never, R>;
}

const withToolTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  timeoutMilliseconds: number,
) =>
  effect.pipe(
    Effect.timeoutFail({
      duration: timeoutMilliseconds,
      onTimeout: () =>
        new McpToolTimeout({
          messageKey: 'mcp.toolTimedOut',
        }),
    }),
  );

const implementMcpToolCore = <
  const Name extends string,
  Parameters extends Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
  Failure extends Schema.Schema.All,
  Mode extends AiTool.FailureMode,
  ToolRequirements,
  E,
  R,
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
  access: McpToolAccess,
  policy: McpToolPolicy,
  handler: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
  ) => Effect.Effect<NoInfer<Schema.Schema.Type<Success>>, E, R>,
): McpToolRegistration<
  | R
  | Schema.Schema.Context<Schema.Struct<Parameters>>
  | Schema.Schema.Context<Success>
  | RequestContext
> => ({
  descriptor: toToolDescriptor(tool, policy),
  access,
  policy,
  execute: (input) => {
    const decoded: Effect.Effect<
      Schema.Schema.Type<Schema.Struct<Parameters>>,
      ParseResult.ParseError,
      Schema.Schema.Context<Schema.Struct<Parameters>>
    > = Schema.decodeUnknown(tool.parametersSchema)(input);

    return decoded.pipe(
      Effect.matchEffect({
        onFailure: presentInvalidInput,
        onSuccess: (decodedInput) => {
          const successSchema = Schema.asSchema(tool.successSchema);
          const handled: Effect.Effect<
            Schema.Schema.Type<Success>,
            E,
            R
          > = handler(decodedInput);
          const encoded: Effect.Effect<
            unknown,
            ParseResult.ParseError | E,
            R | Schema.Schema.Context<Success>
          > = Effect.flatMap(handled, Schema.encode(successSchema));
          const structured: Effect.Effect<
            Schema.Schema.Type<typeof StructuredContentSchema>,
            ParseResult.ParseError | E,
            R | Schema.Schema.Context<Success>
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
            Effect.catchAllCause((cause) =>
              Cause.isInterrupted(cause)
                ? Effect.failCause(Cause.stripFailures(cause))
                : presentToolFailure(cause),
            ),
          );
        },
      }),
    );
  },
});

export interface McpConfirmationPlan<State> {
  readonly request: McpConfirmationRequest;
  readonly state: State;
}

type RejectedConfirmationDecision = Exclude<
  McpConfirmationDecision,
  'accepted'
>;

export const defineMcpQuery = <
  const Name extends string,
  Parameters extends Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
  Failure extends Schema.Schema.All,
  Mode extends AiTool.FailureMode,
  ToolRequirements,
  E,
  R,
>(definition: {
  readonly tool: AiTool.Tool<
    Name,
    {
      readonly parameters: Schema.Struct<Parameters>;
      readonly success: Success;
      readonly failure: Failure;
      readonly failureMode: Mode;
    },
    ToolRequirements
  >;
  readonly access: McpToolAccess;
  readonly policy: McpQueryPolicy;
  readonly timeoutMilliseconds?: number;
  readonly run: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
  ) => Effect.Effect<NoInfer<Schema.Schema.Type<Success>>, E, R>;
}) =>
  implementMcpToolCore(
    definition.tool,
    definition.access,
    definition.policy,
    (input) =>
      withToolTimeout(
        definition.run(input),
        definition.timeoutMilliseconds ?? DEFAULT_TOOL_TIMEOUT_MILLISECONDS,
      ),
  );

export const defineMcpCommand = <
  const Name extends string,
  Parameters extends Schema.Struct.Fields,
  Success extends Schema.Schema.Any,
  Failure extends Schema.Schema.All,
  Mode extends AiTool.FailureMode,
  ToolRequirements,
  E,
  R,
>(definition: {
  readonly tool: AiTool.Tool<
    Name,
    {
      readonly parameters: Schema.Struct<Parameters>;
      readonly success: Success;
      readonly failure: Failure;
      readonly failureMode: Mode;
    },
    ToolRequirements
  >;
  readonly access: McpToolAccess;
  readonly policy: McpCommandPolicyWithoutConfirmation;
  readonly timeoutMilliseconds?: number;
  readonly run: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
  ) => Effect.Effect<NoInfer<Schema.Schema.Type<Success>>, E, R>;
}) =>
  implementMcpToolCore(
    definition.tool,
    definition.access,
    definition.policy,
    (input) =>
      withToolTimeout(
        definition.run(input),
        definition.timeoutMilliseconds ?? DEFAULT_TOOL_TIMEOUT_MILLISECONDS,
      ),
  );

export const defineConfirmedMcpCommand = <
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
>(definition: {
  readonly tool: AiTool.Tool<
    Name,
    {
      readonly parameters: Schema.Struct<Parameters>;
      readonly success: Success;
      readonly failure: Failure;
      readonly failureMode: Mode;
    },
    ToolRequirements
  >;
  readonly access: McpToolAccess;
  readonly policy: McpCommandPolicyWithRequiredConfirmation;
  readonly timeoutMilliseconds?: number;
  readonly prepare: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
  ) => Effect.Effect<McpConfirmationPlan<State>, PrepareE, PrepareR>;
  readonly onRejected: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
    state: State,
    decision: RejectedConfirmationDecision,
  ) => NoInfer<Schema.Schema.Type<Success>>;
  readonly run: (
    input: Schema.Schema.Type<Schema.Struct<Parameters>>,
    state: State,
  ) => Effect.Effect<NoInfer<Schema.Schema.Type<Success>>, ExecuteE, ExecuteR>;
}) =>
  implementMcpToolCore(
    definition.tool,
    definition.access,
    definition.policy,
    (input) =>
      Effect.gen(function* () {
        const timeoutMilliseconds =
          definition.timeoutMilliseconds ?? DEFAULT_TOOL_TIMEOUT_MILLISECONDS;
        const plan = yield* withToolTimeout(
          definition.prepare(input),
          timeoutMilliseconds,
        );
        const invocation = yield* McpInvocation;
        const decision = yield* invocation.requestConfirmation(plan.request);

        if (decision !== 'accepted') {
          return definition.onRejected(input, plan.state, decision);
        }

        yield* requireMcpToolAccess(definition.access);
        return yield* withToolTimeout(
          definition.run(input, plan.state),
          timeoutMilliseconds,
        );
      }),
  );

export interface McpToolRegistry<R> {
  readonly descriptors: readonly McpToolDescriptor[];
  readonly manifest: McpContractManifest;
  readonly listAvailable: Effect.Effect<
    readonly McpToolDescriptor[],
    never,
    McpAccessRequirements
  >;
  readonly execute: (
    name: string,
    input: unknown,
  ) => Effect.Effect<CallToolResult, never, R>;
}

export type McpToolRegistryRequirements<Registry> =
  Registry extends McpToolRegistry<infer R> ? R : never;

export interface McpFeature<R> {
  readonly domain: string;
  readonly contractVersion: number;
  readonly registrations: readonly McpToolRegistration<R>[];
}

export type McpFeatureRequirements<Feature> =
  Feature extends McpFeature<infer R> ? R : never;

export interface McpContractManifest {
  readonly schemaVersion: 1;
  readonly tools: readonly McpToolDescriptor[];
}

export const defineMcpFeature = <R>(config: {
  readonly domain: string;
  readonly contractVersion: number;
  readonly registrations: readonly McpToolRegistration<R>[];
}): McpFeature<R> => {
  if (!/^[a-z][a-z0-9]*$/.test(config.domain)) {
    throw new Error(`Invalid MCP feature domain: ${config.domain}`);
  }
  if (
    !Number.isSafeInteger(config.contractVersion) ||
    config.contractVersion < 1
  ) {
    throw new Error(
      `Invalid MCP contract version for ${config.domain}: ${config.contractVersion}`,
    );
  }

  const prefix = `${config.domain}_`;
  return {
    domain: config.domain,
    contractVersion: config.contractVersion,
    registrations: config.registrations.map((registration) => {
      const { name } = registration.descriptor;
      if (!name.startsWith(prefix)) {
        throw new Error(
          `MCP tool ${name} must start with its feature domain ${prefix}`,
        );
      }

      return {
        ...registration,
        descriptor: {
          ...registration.descriptor,
          _meta: {
            ...registration.descriptor._meta,
            'fr.stocket/tool': {
              domain: config.domain,
              intent: name.slice(prefix.length),
              contractVersion: config.contractVersion,
            },
          },
        },
      };
    }),
  };
};

const validateRegistration = (registration: McpToolRegistration<unknown>) => {
  const { descriptor, policy } = registration;
  if (registration.access.permissions.length === 0) {
    throw new Error(
      `MCP tool ${descriptor.name} must declare at least one permission`,
    );
  }

  if (descriptor.name.length > 64 || !TOOL_NAME_PATTERN.test(descriptor.name)) {
    throw new Error(`Invalid MCP tool name: ${descriptor.name}`);
  }

  if (policy.kind === 'query') {
    if (
      descriptor.annotations?.readOnlyHint !== true ||
      descriptor.annotations.destructiveHint !== false
    ) {
      throw new Error(
        `MCP query ${descriptor.name} must be read-only and non-destructive`,
      );
    }
    return;
  }

  if (descriptor.annotations?.readOnlyHint !== false) {
    throw new Error(`MCP command ${descriptor.name} must not be read-only`);
  }

  if (policy.reversible === 'no' && policy.undoTool !== undefined) {
    throw new Error(
      `Irreversible MCP command ${descriptor.name} cannot declare an undo tool`,
    );
  }

  if (policy.reversible !== 'no' && policy.undoTool === undefined) {
    throw new Error(
      `Reversible MCP command ${descriptor.name} must declare an undo tool`,
    );
  }
};

export const makeMcpToolRegistry = <R>(
  registrations: readonly McpToolRegistration<R>[],
): McpToolRegistry<R | McpAccessRequirements | RequestContext> => {
  const sorted = [...registrations].sort((left, right) =>
    left.descriptor.name.localeCompare(right.descriptor.name),
  );
  const byName = new Map<string, McpToolRegistration<R>>();
  for (const registration of sorted) {
    validateRegistration(registration);
    if (byName.has(registration.descriptor.name)) {
      throw new Error(`Duplicate MCP tool: ${registration.descriptor.name}`);
    }
    byName.set(registration.descriptor.name, registration);
  }

  for (const registration of sorted) {
    if (
      registration.policy.kind === 'command' &&
      registration.policy.undoTool !== undefined &&
      !byName.has(registration.policy.undoTool)
    ) {
      throw new Error(
        `MCP tool ${registration.descriptor.name} references missing undo tool ${registration.policy.undoTool}`,
      );
    }
  }

  const descriptors = sorted.map(({ descriptor }) => descriptor);
  return {
    descriptors,
    manifest: {
      schemaVersion: 1,
      tools: descriptors,
    },
    listAvailable: loadMcpAccessSnapshot.pipe(
      Effect.map((snapshot) =>
        sorted
          .filter(({ access }) => isMcpToolAllowed(access, snapshot))
          .map(({ descriptor }) => descriptor),
      ),
      Effect.catchAll(() => Effect.succeed([])),
    ),
    execute: (name, input) => {
      const registration = byName.get(name);
      if (!registration) return presentUnavailableTool;

      return requireMcpToolAccess(registration.access).pipe(
        Effect.matchEffect({
          onFailure: () => presentUnavailableTool,
          onSuccess: () => registration.execute(input),
        }),
      );
    },
  };
};

export const composeMcpRegistry = <R>(...features: readonly McpFeature<R>[]) =>
  makeMcpToolRegistry(features.flatMap(({ registrations }) => registrations));
