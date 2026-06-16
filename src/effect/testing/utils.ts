import { type Context, Effect, Layer } from 'effect';
import { vi, type Mock } from 'vitest';

/**
 * Creates a test layer for an Effect service tag.
 *
 * Unimplemented methods die loudly with Effect.die() rather than returning
 * undefined silently, so accidental calls to out-of-scope methods fail fast.
 *
 * Usage:
 *   const repoLayer = makeTestLayer(ProductsRepository)({
 *     findById: (id) => Effect.succeed(makeProductEntity({ id })),
 *     findBySku: () => Effect.succeed(null),
 *   });
 *   // Provide via Effect.provide(repoLayer) inside it.effect(...)
 */
const makeUnimplementedProxy = <S extends object>(key: string, service: Partial<S>): S =>
  new Proxy(service as S, {
    get(target, prop) {
      if (prop in target) return (target as any)[prop];
      return () =>
        Effect.die(
          `${key}.${String(prop)} was called in a test but is not implemented in the test layer. Add it to makeTestLayer(${key})({...}).`,
        );
    },
  });

export const makeTestLayer =
  <I, S extends object>(tag: Context.Tag<I, S>) =>
  (service: Partial<S>): Layer.Layer<I> =>
    Layer.succeed(tag, makeUnimplementedProxy(tag.key, service));

export type ChainableMock<T> = {
  [method: string]: Mock;
} & {
  then: (resolve: (value: T) => unknown) => unknown;
};

const DEFAULT_CHAIN_METHODS = [
  'select',
  'from',
  'where',
  'limit',
  'insert',
  'values',
  'onConflictDoUpdate',
  'orderBy',
  'offset',
  'innerJoin',
  'leftJoin',
  'update',
  'set',
  'delete',
  'returning',
] as const;

export const createChainableMock = <T>(
  resolveValue: T,
  extraMethods: readonly string[] = [],
): ChainableMock<T> => {
  const chain = {} as ChainableMock<T>;
  for (const method of [...DEFAULT_CHAIN_METHODS, ...extraMethods]) {
    chain[method] = vi.fn().mockReturnValue(chain);
  }
  chain.then = (resolve) => resolve(resolveValue);
  return chain;
};
