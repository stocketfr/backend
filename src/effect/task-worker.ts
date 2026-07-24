import { readRequiredEnv } from '@stocket/types/common';
import { NodeRuntime } from '@effect/platform-node';
import { Effect } from 'effect';
import {
  APPLICATION_NODE_ENVS,
  assertSafeApplicationEnvironment,
  isApplicationNodeEnv,
  makeProductImportTaskWorkerApplicationLayer,
} from './application/layers';
import { TaskWorkerService } from './modules/tasks/worker/service';
import { runtimeLoggingLayer } from './platform/observability/console-logging';

const nodeEnv = readRequiredEnv('NODE_ENV');
if (!isApplicationNodeEnv(nodeEnv)) {
  throw new Error(
    `Invalid NODE_ENV="${nodeEnv}". Must be one of: ${APPLICATION_NODE_ENVS.join(', ')}`,
  );
}
process.env.NODE_ENV = nodeEnv;
assertSafeApplicationEnvironment(nodeEnv, process.env);

const main = Effect.flatMap(TaskWorkerService, (worker) => worker.runLoop).pipe(
  Effect.provide(makeProductImportTaskWorkerApplicationLayer()),
  Effect.provide(runtimeLoggingLayer),
);

NodeRuntime.runMain(main);
