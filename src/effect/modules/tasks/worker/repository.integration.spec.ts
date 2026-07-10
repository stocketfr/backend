import { TaskStatus } from '@stocket/types/tasks';
import { Effect, Layer } from 'effect';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { DrizzleDatabase } from '../../../platform/db/drizzle';
import { backgroundTasks } from '../../../platform/db/schema';
import { CurrentRequestContext } from '../../../platform/http/request-context';
import {
  getTestDb,
  makeTestRequestContext,
  runTest,
  withTestDb,
} from '../../../testing/test-harness';
import { TasksRepository } from '../repository';
import { TaskWorkerRepository } from './repository';

withTestDb();

const workerLayer = TaskWorkerRepository.Default.pipe(
  Layer.provide(Layer.succeed(DrizzleDatabase, getTestDb())),
);

const enqueueTask = async () => {
  const tenantId = randomUUID();
  const context = { ...makeTestRequestContext(), tenantId };
  const taskLayer = TasksRepository.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(DrizzleDatabase, getTestDb()),
        Layer.succeed(CurrentRequestContext, context),
      ),
    ),
  );

  const result = await runTest(
    Effect.flatMap(TasksRepository, (repository) =>
      repository.enqueue({
        type: 'test-task',
        payload: { blobKey: 'imports/test.csv' },
        createdBy: 'worker-integration-test',
      }),
    ),
    taskLayer,
  );
  return result.task;
};

describe('TaskWorkerRepository integration', () => {
  it('uses a fresh lease token to fence a reclaimed attempt', async () => {
    const task = await enqueueTask();
    const first = await runTest(
      Effect.flatMap(TaskWorkerRepository, (repository) =>
        repository.claimNext({ workerId: 'worker-a', leaseMs: 60_000 }),
      ),
      workerLayer,
    );
    expect(first?.row.id).toBe(task.id);

    await getTestDb()
      .update(backgroundTasks)
      .set({ lease_expires_at: new Date(Date.now() - 1_000) })
      .where(eq(backgroundTasks.id, task.id));
    await runTest(
      Effect.flatMap(TaskWorkerRepository, (repository) =>
        repository.recoverExpired(0),
      ),
      workerLayer,
    );
    const second = await runTest(
      Effect.flatMap(TaskWorkerRepository, (repository) =>
        repository.claimNext({ workerId: 'worker-b', leaseMs: 60_000 }),
      ),
      workerLayer,
    );

    expect(second?.leaseToken).not.toBe(first?.leaseToken);
    expect(second?.row.attempt_count).toBe(2);
    if (first === null || second === null) {
      throw new Error('Expected both task claims to succeed');
    }

    const staleHeartbeat = await runTest(
      Effect.flatMap(TaskWorkerRepository, (repository) =>
        repository.heartbeat(first, 60_000),
      ),
      workerLayer,
    );
    const activeHeartbeat = await runTest(
      Effect.flatMap(TaskWorkerRepository, (repository) =>
        repository.heartbeat(second, 60_000),
      ),
      workerLayer,
    );
    expect(staleHeartbeat).toEqual({
      active: false,
      cancelRequested: false,
    });
    expect(activeHeartbeat).toEqual({
      active: true,
      cancelRequested: false,
    });
  });

  it('honors a cancellation that races with successful completion', async () => {
    const task = await enqueueTask();
    const claimed = await runTest(
      Effect.flatMap(TaskWorkerRepository, (repository) =>
        repository.claimNext({ workerId: 'worker-a', leaseMs: 60_000 }),
      ),
      workerLayer,
    );
    if (claimed === null) throw new Error('Expected task claim to succeed');

    await getTestDb()
      .update(backgroundTasks)
      .set({ cancel_requested_at: new Date() })
      .where(eq(backgroundTasks.id, task.id));
    const status = await runTest(
      Effect.flatMap(TaskWorkerRepository, (repository) =>
        repository.complete(claimed, { imported: 1 }),
      ),
      workerLayer,
    );

    expect(status).toBe('canceled');
    const [stored] = await getTestDb()
      .select()
      .from(backgroundTasks)
      .where(eq(backgroundTasks.id, task.id));
    expect(stored).toMatchObject({
      status: TaskStatus.CANCELED,
      payload: null,
      result: null,
    });
  });
});
