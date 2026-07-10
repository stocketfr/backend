import { NodeSdk } from '@effect/opentelemetry';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { readTracingRuntimeConfig } from '../config/observability-config';

export const makeTracingLayer = (serviceName: string) =>
  NodeSdk.layer(() => {
    const config = readTracingRuntimeConfig();
    return {
      resource: {
        serviceName,
        attributes: {
          'deployment.environment': config.deploymentEnvironment,
        },
      },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: config.otlpTraceEndpoint,
        }),
      ),
    };
  });

export const TracingLive = makeTracingLayer('stocket-api');
