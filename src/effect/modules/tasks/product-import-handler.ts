import { Effect } from 'effect';
import type {
  ProductImportApprovedPlanDto,
  ProductImportTypeDto,
} from '@stocket/types/products';
import { ProductImportService } from '../products/import/service';
import {
  ProductImportCancelled,
  ProductImportCsvParseFailed,
  ProductImportUnsupportedFormat,
  ProductsInfrastructureError,
} from '../products/products.errors';
import { TaskPayloadInvalid } from './tasks.errors';
import type {
  TaskExecutionContext,
  TaskHandlerOutcome,
  TaskRow,
} from './types';
import { describeTaskError } from './utils';

interface ProductImportTaskPayload {
  readonly content: string;
  readonly importType?: ProductImportTypeDto;
  readonly approvedPlan?: ProductImportApprovedPlanDto;
  readonly userId: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const parsePayload = (task: TaskRow) =>
  Effect.gen(function* () {
    const payload = task.payload;
    if (!isRecord(payload) || typeof payload.content !== 'string') {
      return yield* Effect.fail(
        new TaskPayloadInvalid({
          taskId: task.id,
          taskType: task.type,
          messageKey: 'tasks.payloadInvalid',
        }),
      );
    }

    return {
      content: payload.content,
      importType:
        typeof payload.importType === 'string'
          ? (payload.importType as ProductImportTypeDto)
          : undefined,
      approvedPlan: isRecord(payload.approvedPlan)
        ? (payload.approvedPlan as ProductImportApprovedPlanDto)
        : undefined,
      userId:
        typeof payload.userId === 'string'
          ? payload.userId
          : (task.created_by ?? 'system'),
    } satisfies ProductImportTaskPayload;
  });

const isPermanentImportFailure = (error: unknown) =>
  error instanceof ProductImportCsvParseFailed ||
  error instanceof ProductImportUnsupportedFormat ||
  error instanceof TaskPayloadInvalid;

export class ProductImportTaskHandler extends Effect.Service<ProductImportTaskHandler>()(
  '@stocket/effect/tasks/ProductImportTaskHandler',
  {
    effect: Effect.gen(function* () {
      const productImportService = yield* ProductImportService;

      const run = (
        task: TaskRow,
        context: TaskExecutionContext,
      ): Effect.Effect<TaskHandlerOutcome> =>
        parsePayload(task).pipe(
          Effect.flatMap((payload) =>
            productImportService.importFromCsvContent({
              content: payload.content,
              importType: payload.importType,
              approvedPlan: payload.approvedPlan,
              userId: payload.userId,
              hooks: {
                onProgress: (progress) =>
                  context.reportProgress({
                    total: progress.total,
                    processed: progress.processed,
                    failed: progress.failed,
                    message: progress.message ?? null,
                  }),
                isCancelRequested: context.isCancelRequested,
              },
            }),
          ),
          Effect.map(
            (result): TaskHandlerOutcome => ({ _tag: 'succeeded', result }),
          ),
          Effect.catchAll(
            (error): Effect.Effect<TaskHandlerOutcome, never, never> => {
              if (error instanceof ProductImportCancelled) {
                const outcome: TaskHandlerOutcome = {
                  _tag: 'canceled',
                  error: 'Task canceled during product import',
                };
                return Effect.succeed(outcome);
              }

              if (isPermanentImportFailure(error)) {
                const outcome: TaskHandlerOutcome = {
                  _tag: 'failed',
                  error: describeTaskError(error),
                  retryable: false,
                };
                return Effect.succeed(outcome);
              }

              const outcome: TaskHandlerOutcome = {
                _tag: 'failed',
                error: describeTaskError(error),
                retryable: error instanceof ProductsInfrastructureError,
              };
              return Effect.succeed(outcome);
            },
          ),
        );

      return { run };
    }),
    dependencies: [ProductImportService.Default],
  },
) {}
