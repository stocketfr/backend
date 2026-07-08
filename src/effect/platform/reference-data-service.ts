import { Effect } from 'effect';
import { makeGetOrFail } from './effect/from-null-or';
import {
  makeEnsureExistByIds,
  makeEnsureExistsById,
} from './effect/existence';

export interface ReferenceEntityOperationsOptions<
  Entity extends { readonly id: string },
  Response,
  NotFound,
  LookupError,
  LookupContext,
  DeleteError = LookupError,
  DeleteContext = LookupContext,
> {
  readonly findById: (
    id: string,
  ) => Effect.Effect<Entity | null, LookupError, LookupContext>;
  readonly deleteById: (
    id: string,
  ) => Effect.Effect<void, DeleteError, DeleteContext>;
  readonly existsById: (
    id: string,
  ) => Effect.Effect<boolean, LookupError, LookupContext>;
  readonly findByIds: (
    ids: readonly string[],
  ) => Effect.Effect<readonly Entity[], LookupError, LookupContext>;
  readonly makeNotFound: (id: string) => NotFound;
  readonly toResponse: (entity: NonNullable<Entity>) => Response;
}

export const makeReferenceEntityOperations = <
  Entity extends { readonly id: string },
  Response,
  NotFound,
  LookupError,
  LookupContext,
  DeleteError = LookupError,
  DeleteContext = LookupContext,
>(
  options: ReferenceEntityOperationsOptions<
    Entity,
    Response,
    NotFound,
    LookupError,
    LookupContext,
    DeleteError,
    DeleteContext
  >,
) => {
  const getOrFail = makeGetOrFail(options.findById, options.makeNotFound);
  const ensureExistsById = makeEnsureExistsById(
    options.existsById,
    options.makeNotFound,
  );
  const ensureExistByIds = makeEnsureExistByIds(
    options.findByIds,
    options.makeNotFound,
  );

  const findOne = (id: string) =>
    Effect.map(getOrFail(id), options.toResponse);

  const remove = (id: string) =>
    Effect.gen(function* () {
      yield* getOrFail(id);
      yield* options.deleteById(id);
    });

  return {
    getOrFail,
    findOne,
    remove,
    existsById: options.existsById,
    ensureExistsById,
    ensureExistByIds,
  };
};
