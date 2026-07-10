import { describe, expect, expectTypeOf, it } from '@effect/vitest';
import { Cause, Context, Data, Effect, Exit, Layer } from 'effect';
import { vi } from 'vitest';
import {
  makeMockServiceLayer,
  makeServiceTestHarness,
  makeTestLayer,
} from './utils';

interface TestRepositoryShape {
  readonly find: () => Effect.Effect<string>;
  readonly remove: () => Effect.Effect<void>;
}

class TestRepository extends Context.Tag(
  '@stocket/effect/testing/TestRepository',
)<TestRepository, TestRepositoryShape>() {}

interface TestServiceShape {
  readonly value: string;
}

class TestService extends Context.Tag('@stocket/effect/testing/TestService')<
  TestService,
  TestServiceShape
>() {}

class DependencyEnvironment extends Context.Tag(
  '@stocket/effect/testing/DependencyEnvironment',
)<DependencyEnvironment, string>() {}

class BodyEnvironment extends Context.Tag(
  '@stocket/effect/testing/BodyEnvironment',
)<BodyEnvironment, string>() {}

class BuildError extends Data.TaggedError('BuildError') {}

class DependencyError extends Data.TaggedError('DependencyError') {}

class BodyError extends Data.TaggedError('BodyError') {}

const serviceLayer = Layer.effect(
  TestService,
  Effect.gen(function* () {
    const repository = yield* TestRepository;
    const value = yield* repository.find();
    if (value === 'build-failure') {
      return yield* new BuildError();
    }
    return { value };
  }),
);

const dependencyLayer = Layer.effect(
  TestRepository,
  Effect.gen(function* () {
    const value = yield* DependencyEnvironment;
    if (value === 'dependency-failure') {
      return yield* new DependencyError();
    }
    return {
      find: () => Effect.succeed(value),
      remove: () => Effect.void,
    };
  }),
);

const harness = makeServiceTestHarness(TestService, serviceLayer);

const nativeDependencyLayer = makeTestLayer(TestRepository)({
  find: () => Effect.succeed('native-layer-value'),
  remove: () => Effect.void,
});

const environmentAndErrorProgram = harness.effect(dependencyLayer, (service) =>
  Effect.gen(function* () {
    const suffix = yield* BodyEnvironment;
    if (suffix === 'body-failure') {
      return yield* new BodyError();
    }
    return `${service.value}${suffix}`;
  }),
);

expectTypeOf(environmentAndErrorProgram).toEqualTypeOf<
  Effect.Effect<
    string,
    BuildError | DependencyError | BodyError,
    DependencyEnvironment | BodyEnvironment
  >
>();

describe('Effect test helpers', () => {
  it('creates fresh mock services for every call', () => {
    const makeRepository = makeMockServiceLayer(TestRepository, () => ({
      find: vi.fn(() => Effect.succeed('value')),
    }));

    const first = makeRepository();
    const second = makeRepository();

    first.service.find();

    expect(first.service.find).toHaveBeenCalledOnce();
    expect(second.service.find).not.toHaveBeenCalled();
    expect(first.service.find).not.toBe(second.service.find);
  });

  it.effect('dies loudly when an unimplemented service method is called', () =>
    Effect.gen(function* () {
      const repository = yield* TestRepository;
      const exit = yield* Effect.exit(repository.remove());

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.pretty(exit.cause)).toContain(
          '@stocket/effect/testing/TestRepository.remove was called in a test but is not implemented',
        );
      }
    }).pipe(
      Effect.provide(
        makeTestLayer(TestRepository)({
          find: () => Effect.succeed('value'),
        }),
      ),
    ),
  );

  it.layer(
    Layer.mergeAll(
      Layer.succeed(DependencyEnvironment, 'dependency-value'),
      Layer.succeed(BodyEnvironment, '-body-value'),
    ),
  )('service harness environment propagation', (it) => {
    it.effect('preserves remaining environments through native layers', () =>
      Effect.gen(function* () {
        const result = yield* environmentAndErrorProgram;
        expect(result).toBe('dependency-value-body-value');
      }),
    );
  });

  it.layer(harness.layer(nativeDependencyLayer))(
    'service harness native layer compatibility',
    (it) => {
      it.effect('provides the service through @effect/vitest', () =>
        Effect.gen(function* () {
          const service = yield* TestService;
          expect(service.value).toBe('native-layer-value');
        }),
      );
    },
  );
});
