import { InternalError } from '../../platform/effect/domain-errors';

export class McpToolTimeout extends InternalError('McpToolTimeout') {}
