import { NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { readRequiredEnv } from '@stocket/types/common';
import {
  APPLICATION_NODE_ENVS,
  isApplicationNodeEnv,
  makeApplicationLayer,
  makeHttpServerLayer,
  parseApplicationPort,
  type ApplicationRuntimeError,
} from './application/layers';
import { runtimeLoggingLayer } from './platform/observability/console-logging';

const nodeEnv = readRequiredEnv('NODE_ENV');
if (!isApplicationNodeEnv(nodeEnv)) {
  throw new Error(
    `Invalid NODE_ENV="${nodeEnv}". Must be one of: ${APPLICATION_NODE_ENVS.join(', ')}`,
  );
}
process.env.NODE_ENV = nodeEnv;

const port = parseApplicationPort(readRequiredEnv('PORT'));

const applicationLayer = makeApplicationLayer({
  nodeEnv,
});

const main: Effect.Effect<never, ApplicationRuntimeError, never> = Layer.launch(
  makeHttpServerLayer(port),
).pipe(Effect.provide(applicationLayer), Effect.provide(runtimeLoggingLayer));

NodeRuntime.runMain(main);
