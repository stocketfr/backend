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
const makeUnimplementedProxy = <S extends object>(
  key: string,
  service: Partial<S>,
): S =>
  new Proxy(service as S, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
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

/**
 * Builds a per-test mock service object and its loud test layer together.
 *
 * `makeDefaults` runs for every call, so Vitest mocks are isolated per test.
 * The returned `service` keeps the precise `vi.fn` types for assertions while
 * `layer` is ready to pass to `makeServiceTestHarness(...).effect(...)`.
 */
export const makeMockServiceLayer =
  <I, S extends object, Defaults extends Partial<S>>(
    tag: Context.Tag<I, S>,
    makeDefaults: () => Defaults,
  ) =>
  <Overrides extends Partial<S> = Record<never, never>>(
    overrides?: Overrides,
  ) => {
    const service = { ...makeDefaults(), ...overrides };
    return {
      service,
      layer: makeTestLayer(tag)(service),
    };
  };

/**
 * Harness for Effect service unit specs.
 *
 * It wires a module-under-test layer to a collaborator layer and yields the
 * concrete service to the test body, avoiding per-spec run/provide helpers.
 */
export const makeServiceTestHarness = <I, S extends object, BuildError, RIn>(
  tag: Context.Tag<I, S>,
  serviceLayer: Layer.Layer<I, BuildError, RIn>,
) => {
  const layer = <DependencyError, RRemaining>(
    dependencies: Layer.Layer<RIn, DependencyError, RRemaining>,
  ) => serviceLayer.pipe(Layer.provide(dependencies));

  const effect = <A, TestError, RTest, DependencyError, RRemaining>(
    dependencies: Layer.Layer<RIn, DependencyError, RRemaining>,
    body: (service: S) => Effect.Effect<A, TestError, RTest>,
  ) =>
    Effect.gen(function* () {
      const service = yield* tag;
      return yield* body(service);
    }).pipe(Effect.provide(layer(dependencies)));

  return { layer, effect };
};

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
  // oxlint-disable-next-line unicorn/no-thenable -- Drizzle query mocks are awaited in tests.
  chain.then = (resolve) => resolve(resolveValue);
  return chain;
};
