import { NodeRuntime } from '@effect/platform-node';
import { Effect, Layer } from 'effect';
import { readRequiredEnv } from '@stocket/types/common';
import {
  APPLICATION_NODE_ENVS,
  isApplicationNodeEnv,
  makeApplicationLayer,
  makeHttpServerLayer,
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

const port = Number(readRequiredEnv('PORT'));
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('PORT must be a positive integer');
}

const applicationLayer = makeApplicationLayer({
  nodeEnv,
  runBetterAuthMigrations: process.env.RUN_BETTER_AUTH_MIGRATIONS === 'true',
});

const main = Layer.launch(makeHttpServerLayer(port)).pipe(
  Effect.provide(applicationLayer),
  Effect.provide(runtimeLoggingLayer),
);

NodeRuntime.runMain(
  main as Effect.Effect<never, ApplicationRuntimeError, never>,
);
