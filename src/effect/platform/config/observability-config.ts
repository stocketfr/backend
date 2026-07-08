const DEFAULT_OTLP_TRACE_ENDPOINT = 'http://localhost:4318/v1/traces';

export interface TracingRuntimeConfig {
  readonly deploymentEnvironment: string | undefined;
  readonly otlpTraceEndpoint: string;
}

export const readTracingRuntimeConfig = (): TracingRuntimeConfig => ({
  deploymentEnvironment: process.env.NODE_ENV,
  otlpTraceEndpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULT_OTLP_TRACE_ENDPOINT,
});

export const readLogLevelName = () =>
  process.env.LOG_LEVEL?.trim().toLowerCase();

export const readSqlLogModeName = () =>
  process.env.LOG_SQL?.trim().toLowerCase();
