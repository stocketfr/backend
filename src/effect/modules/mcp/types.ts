import { Context, type Effect } from 'effect';

export type McpConfirmationDecision = 'accepted' | 'declined' | 'unavailable';

export interface McpConfirmationRequest {
  readonly message: string;
  readonly confirmLabel: string;
}

export interface McpInvocation {
  readonly requestConfirmation: (
    request: McpConfirmationRequest,
  ) => Effect.Effect<McpConfirmationDecision>;
}

export const McpInvocation = Context.GenericTag<McpInvocation>(
  '@stocket/effect/mcp/McpInvocation',
);

interface McpToolSafetyBase {
  readonly effect: string;
  readonly reversible: 'yes' | 'best-effort' | 'no';
  readonly undoTool?: string;
}

export interface McpToolSafetyWithoutConfirmation extends McpToolSafetyBase {
  readonly confirmation: 'never';
}

export interface McpToolSafetyWithRequiredConfirmation extends McpToolSafetyBase {
  readonly confirmation: 'required';
}

export type McpToolSafety =
  | McpToolSafetyWithoutConfirmation
  | McpToolSafetyWithRequiredConfirmation;
