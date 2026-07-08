import { Effect } from 'effect';
import {
  createBulkResultBuilder,
  partitionByExistence,
  type BulkOperationResult,
} from '@stocket/types/common';

interface EntityWithId {
  readonly id: string;
}

export interface RunBulkByIdsOptions<
  Entity extends EntityWithId,
  EFind,
  EAct,
  RFind,
  RAct,
> {
  readonly ids: readonly string[];
  readonly find: (
    ids: readonly string[],
  ) => Effect.Effect<readonly Entity[], EFind, RFind>;
  readonly act: (
    ids: readonly string[],
  ) => Effect.Effect<readonly string[], EAct, RAct>;
  readonly entityName?: string;
  readonly notFoundError?: string;
}

export const runBulkByIds = <
  Entity extends EntityWithId,
  EFind,
  EAct,
  RFind,
  RAct,
>({
  ids,
  find,
  act,
  entityName,
  notFoundError,
}: RunBulkByIdsOptions<
  Entity,
  EFind,
  EAct,
  RFind,
  RAct
>): Effect.Effect<BulkOperationResult<string>, EFind | EAct, RFind | RAct> =>
  Effect.gen(function* () {
    const result = createBulkResultBuilder<string>();
    const requestedIds = [...ids];
    if (requestedIds.length === 0) {
      return result.build();
    }

    const existingEntities = yield* find(requestedIds);
    const existingIds = new Set(existingEntities.map((entity) => entity.id));
    const { existing, notFound } = partitionByExistence(
      requestedIds,
      existingIds,
    );

    if (notFoundError === undefined) {
      result.addNotFoundFailures(notFound, entityName);
    } else {
      for (const id of notFound) {
        result.addFailure(notFoundError, { id });
      }
    }
    if (existing.length === 0) {
      return result.build();
    }

    const succeeded = [...(yield* act(existing))];
    return result.buildWith({
      succeeded,
      success_count: succeeded.length,
    });
  });
