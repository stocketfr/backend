import { HttpServerRequest } from '@effect/platform';
import type { Schema } from 'effect';

/**
 * `HttpServerRequest.schemaSearchParams` requires an encoded type with a
 * string-valued index signature. Locally defined `Schema.Struct` query types do
 * not carry one, although each field encodes to a URL search param at runtime.
 */
export const searchParams = <A, I, R>(schema: Schema.Schema<A, I, R>) =>
  HttpServerRequest.schemaSearchParams(
    schema as unknown as Schema.Schema<
      A,
      Record<string, string | ReadonlyArray<string> | undefined>,
      R
    >,
  );
