import { randomUUID } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { TaskStatus } from '@stocket/types/tasks';
import { DrizzleDatabase } from '../../platform/db/drizzle';
import { CurrentRequestContext } from '../../platform/http/request-context';
import {
  getTestDb,
  makeTestRequestContext,
  runTest,
  withTestDb,
} from '../../testing/test-harness';
import { TasksRepository } from './repository';

const ACTOR_ID = '20000000-0000-4000-a000-000000000001';
const OTHER_ACTOR_ID = '20000000-0000-4000-a000-000000000002';

withTestDb();

const makeRepositoryLayer = (tenantId: string) => {
  const context = { ...makeTestRequestContext(), tenantId };
  const platformLayer = Layer.mergeAll(
    Layer.succeed(DrizzleDatabase, getTestDb()),
    Layer.succeed(CurrentRequestContext, context),
  );
  return TasksRepository.Default.pipe(Layer.provide(platformLayer));
};

const enqueue = (
  layer: ReturnType<typeof makeRepositoryLayer>,
  actorId: string,
) =>
  runTest(
    Effect.flatMap(TasksRepository, (repository) =>
      repository.enqueue({
        type: 'test-task',
        payload: { value: 'test' },
        createdBy: actorId,
        idempotencyKey: 'request-1',
      }),
    ),
    layer,
  );

describe('TasksRepository integration', () => {
  it('deduplicates enqueueing within tenant, creator, and task type', async () => {
    const layer = makeRepositoryLayer(randomUUID());

    const first = await enqueue(layer, ACTOR_ID);
    const second = await enqueue(layer, ACTOR_ID);

    expect(second.id).toBe(first.id);
  });

  it('keeps task visibility scoped to both tenant and creator', async () => {
    const tenantLayer = makeRepositoryLayer(randomUUID());
    const otherTenantLayer = makeRepositoryLayer(randomUUID());
    const task = await enqueue(tenantLayer, ACTOR_ID);

    const otherActorResult = await runTest(
      Effect.flatMap(TasksRepository, (repository) =>
        repository.findByIdForActor(task.id, OTHER_ACTOR_ID),
      ),
      tenantLayer,
    );
    const otherTenantResult = await runTest(
      Effect.flatMap(TasksRepository, (repository) =>
        repository.findByIdForActor(task.id, ACTOR_ID),
      ),
      otherTenantLayer,
    );

    expect(otherActorResult).toBeNull();
    expect(otherTenantResult).toBeNull();
  });

  it('cancels queued work atomically and clears its payload', async () => {
    const layer = makeRepositoryLayer(randomUUID());
    const task = await enqueue(layer, ACTOR_ID);

    const canceled = await runTest(
      Effect.flatMap(TasksRepository, (repository) =>
        repository.requestCancellation(task.id, ACTOR_ID),
      ),
      layer,
    );

    expect(canceled).toMatchObject({
      id: task.id,
      status: TaskStatus.CANCELED,
      payload: null,
    });
    expect(canceled?.completed_at).toBeInstanceOf(Date);
  });
});
