const PG_UNIQUE_VIOLATION_CODE = '23505';

interface PgErrorLike {
  readonly code?: unknown;
  readonly constraint?: unknown;
  readonly cause?: unknown;
}

const asPgError = (value: unknown): PgErrorLike | null =>
  value !== null && typeof value === 'object' ? value : null;

export const pgUniqueViolationConstraintName = (
  cause: unknown,
): string | null => {
  const topLevel = asPgError(cause);
  const candidates = [topLevel, asPgError(topLevel?.cause)];

  for (const candidate of candidates) {
    if (
      candidate?.code === PG_UNIQUE_VIOLATION_CODE &&
      typeof candidate.constraint === 'string'
    ) {
      return candidate.constraint;
    }
  }

  return null;
};
