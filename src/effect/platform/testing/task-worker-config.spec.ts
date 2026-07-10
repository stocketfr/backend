import { ConfigProvider, Effect } from 'effect';
import { TaskWorkerConfig } from '../config/task-worker-config';

const runWithEnv = (values: Record<string, string>) =>
  Effect.runPromise(
    TaskWorkerConfig.pipe(
      Effect.provide(TaskWorkerConfig.Default),
      Effect.withConfigProvider(
        ConfigProvider.fromMap(new Map(Object.entries(values))),
      ),
    ),
  );

describe('TaskWorkerConfig', () => {
  it('loads safe defaults', async () => {
    await expect(runWithEnv({})).resolves.toMatchObject({
      concurrency: 4,
      leaseMs: 60_000,
      heartbeatMs: 15_000,
      pollMs: 1_000,
      recoveryMs: 30_000,
      retryDelayMs: 30_000,
      progressThrottleMs: 500,
    });
  });

  it('rejects a heartbeat interval that cannot renew the lease in time', async () => {
    await expect(
      runWithEnv({
        BACKGROUND_TASK_LEASE_MS: '1000',
        BACKGROUND_TASK_HEARTBEAT_MS: '1000',
      }),
    ).rejects.toThrow(
      'BACKGROUND_TASK_HEARTBEAT_MS must be less than BACKGROUND_TASK_LEASE_MS',
    );
  });

  it('bounds worker concurrency', async () => {
    await expect(
      runWithEnv({ BACKGROUND_TASK_CONCURRENCY: '33' }),
    ).rejects.toThrow('BACKGROUND_TASK_CONCURRENCY must not exceed 32');
  });
});
