import { Effect, Layer } from 'effect';
import { FeaturesService } from '../features/service';
import { TasksRepository } from './repository';
import { TaskRegistry } from './registry';
import type { TaskHandlerOutcome, TaskRow } from './types';
import { TaskWorkerService } from './worker';

const now = new Date('2026-01-01T00:00:00.000Z');

const makeTaskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  tenant_id: '22222222-2222-4222-8222-222222222222',
  type: 'product-import',
  status: 'running',
  payload: {
    content: 'sku,name,category_path\nSKU-1,Whisky,Spirits\n',
    importType: 'auto',
    userId: 'user-1',
  },
  result: null,
  error: null,
  created_by: 'user-1',
  attempt_count: 1,
  max_attempts: 3,
  run_after: now,
  lease_owner: 'worker-1',
  lease_expires_at: now,
  progress_total: null,
  progress_processed: 0,
  progress_failed: 0,
  progress_message: null,
  cancel_requested_at: null,
  started_at: now,
  completed_at: null,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const makeRepository = (claimResult: TaskRow | null = makeTaskRow()) => ({
  recoverExpired: vi.fn().mockReturnValue(Effect.succeed(0)),
  claimNext: vi.fn().mockReturnValue(Effect.succeed(claimResult)),
  heartbeat: vi.fn().mockReturnValue(Effect.succeed(true)),
  reportProgress: vi.fn().mockReturnValue(Effect.succeed(true)),
  isCancelRequested: vi.fn().mockReturnValue(Effect.succeed(false)),
  complete: vi.fn().mockReturnValue(Effect.succeed(true)),
  markCanceled: vi.fn().mockReturnValue(Effect.succeed(true)),
  fail: vi.fn().mockReturnValue(Effect.succeed(true)),
});

const makeRegistry = (
  outcome: TaskHandlerOutcome = {
    _tag: 'succeeded',
    result: { productsCreated: 1 },
  },
) => ({
  authorizeExecution: vi.fn().mockReturnValue(Effect.void),
  getHandler: vi.fn().mockReturnValue(
    Effect.succeed({
      run: vi.fn((_task: TaskRow, context) =>
        context
          .reportProgress({
            total: 1,
            processed: 1,
            failed: outcome._tag === 'failed' ? 1 : 0,
            message: 'done',
          })
          .pipe(Effect.as(outcome)),
      ),
    }),
  ),
});

const buildWorker = async (
  repository = makeRepository(),
  registry = makeRegistry(),
) =>
  Effect.runPromise(
    TaskWorkerService.pipe(
      Effect.provide(
        TaskWorkerService.DefaultWithoutDependencies.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(TasksRepository, repository as never),
              Layer.succeed(TaskRegistry, registry as never),
            ),
          ),
        ),
      ),
    ),
  );

const testFeaturesService = {
  requireFeature: () => Effect.void,
} as unknown as FeaturesService;

const runOnce = (worker: TaskWorkerService) =>
  Effect.runPromise(
    worker.runOnce.pipe(
      Effect.provideService(FeaturesService, testFeaturesService),
    ),
  );

describe('TaskWorkerService', () => {
  it('claims a task, dispatches the handler, records progress, and completes', async () => {
    const repository = makeRepository();
    const registry = makeRegistry({
      _tag: 'succeeded',
      result: { productsCreated: 1 },
    });
    const worker = await buildWorker(repository, registry);

    await expect(runOnce(worker)).resolves.toBe(true);

    expect(repository.recoverExpired).toHaveBeenCalledTimes(1);
    expect(repository.claimNext).toHaveBeenCalledTimes(1);
    expect(registry.authorizeExecution).toHaveBeenCalledWith('product-import');
    expect(repository.reportProgress).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.any(String),
      { total: 1, processed: 1, failed: 0, message: 'done' },
    );
    expect(repository.complete).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.any(String),
      { productsCreated: 1 },
    );
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it('requeues retryable handler failures through the fenced failure path', async () => {
    const repository = makeRepository();
    const worker = await buildWorker(
      repository,
      makeRegistry({
        _tag: 'failed',
        error: 'database unavailable',
        retryable: true,
      }),
    );

    await expect(runOnce(worker)).resolves.toBe(true);

    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.any(String),
      'database unavailable',
      true,
      expect.any(Number),
    );
  });

  it('settles canceled handler outcomes as canceled', async () => {
    const repository = makeRepository();
    const worker = await buildWorker(
      repository,
      makeRegistry({
        _tag: 'canceled',
        error: 'Task canceled during product import',
      }),
    );

    await expect(runOnce(worker)).resolves.toBe(true);

    expect(repository.markCanceled).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      expect.any(String),
      'Task canceled during product import',
    );
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('returns false when no task can be claimed', async () => {
    const repository = makeRepository(null);
    const registry = makeRegistry();
    const worker = await buildWorker(repository, registry);

    await expect(runOnce(worker)).resolves.toBe(false);

    expect(repository.recoverExpired).toHaveBeenCalledTimes(1);
    expect(registry.getHandler).not.toHaveBeenCalled();
  });
});
