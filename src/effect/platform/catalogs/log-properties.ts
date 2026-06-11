export interface LogProperties {
  readonly action: string;
  readonly allowedTypes: string;
  readonly cause: unknown;
  readonly details: string;
  readonly durationMs: number;
  readonly entityId: string;
  readonly entityType: string;
  readonly error: unknown;
  readonly from: string;
  readonly maxSize: number;
  readonly method: string;
  readonly path: string;
  readonly requestId: string;
  readonly statusCode: number;
  readonly template: string;
  readonly tenantId: string;
  readonly to: string;
  readonly userAgent: string;
}
