import { Effect } from 'effect';
import { makeGetOrFail } from './effect/from-null-or';

export interface ReferenceEntityOperationsOptions<
  Entity,
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
  readonly makeNotFound: (id: string) => NotFound;
  readonly toResponse: (entity: NonNullable<Entity>) => Response;
}

export interface ReferenceExistsValidatorOptions<
  NotFound,
  LookupError,
  LookupContext,
> {
  readonly existsById: (
    id: string,
  ) => Effect.Effect<boolean, LookupError, LookupContext>;
  readonly makeNotFound: (id: string) => NotFound;
}

export const makeReferenceExistsValidator =
  <NotFound, LookupError, LookupContext>(
    options: ReferenceExistsValidatorOptions<
      NotFound,
      LookupError,
      LookupContext
    >,
  ) =>
  (id: string): Effect.Effect<void, NotFound | LookupError, LookupContext> =>
    options.existsById(id).pipe(
      Effect.filterOrFail(Boolean, () => options.makeNotFound(id)),
      Effect.asVoid,
    );

export const makeReferenceEntityOperations = <
  Entity,
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
  const ensureExists = makeReferenceExistsValidator({
    existsById: options.existsById,
    makeNotFound: options.makeNotFound,
  });

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
    ensureExists,
  };
};
