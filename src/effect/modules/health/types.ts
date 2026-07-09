import type {
  AnyMessageKey,
  MessageArgs,
} from '../../platform/observability/messages';

export interface HealthDetails {
  readonly status: 'up' | 'down';
  readonly message?: string;
  readonly messageKey?: AnyMessageKey;
  readonly messageArgs?: MessageArgs;
}

export interface HealthCheckResponse {
  readonly status: 'ok' | 'error';
  readonly info: Record<string, HealthDetails>;
  readonly error: Record<string, HealthDetails>;
  readonly details: Record<string, HealthDetails>;
}
