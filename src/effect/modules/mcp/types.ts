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

interface McpToolPolicyBase {
  readonly effect: string;
}

export interface McpQueryPolicy extends McpToolPolicyBase {
  readonly kind: 'query';
  readonly confirmation: 'never';
}

interface McpCommandPolicyBase extends McpToolPolicyBase {
  readonly kind: 'command';
  readonly reversible: 'yes' | 'best-effort' | 'no';
  readonly undoTool?: string;
}

export interface McpCommandPolicyWithoutConfirmation extends McpCommandPolicyBase {
  readonly confirmation: 'never';
}

export interface McpCommandPolicyWithRequiredConfirmation extends McpCommandPolicyBase {
  readonly confirmation: 'required';
}

export type McpToolPolicy =
  | McpQueryPolicy
  | McpCommandPolicyWithoutConfirmation
  | McpCommandPolicyWithRequiredConfirmation;
