import {
  created,
  existing,
  type CreateOrReuseResult,
} from '../effect/create-or-reuse';

interface InsertOrGetOptions<A> {
  /** Must use a database uniqueness constraint to arbitrate concurrent calls. */
  readonly insert: () => Promise<A | undefined>;
  readonly getExisting: () => Promise<A | undefined>;
  readonly unresolvedConflictError: () => Error;
}

/**
 * Resolves an atomic INSERT ... ON CONFLICT DO NOTHING operation to either the
 * inserted row or the row that already owns the same business key.
 */
export const insertOrGet = async <A>({
  insert,
  getExisting,
  unresolvedConflictError,
}: InsertOrGetOptions<A>): Promise<CreateOrReuseResult<A>> => {
  const inserted = await insert();
  if (inserted !== undefined) return created(inserted);

  const found = await getExisting();
  if (found !== undefined) return existing(found);

  throw unresolvedConflictError();
};
