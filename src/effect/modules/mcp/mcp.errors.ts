import { ConflictError } from '../../platform/effect/domain-errors';

export class McpConfirmationConflict extends ConflictError(
  'McpConfirmationConflict',
)<{
  readonly resourceId: string;
}> {}
