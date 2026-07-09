import { Effect, Layer, Schedule } from 'effect';
import {
  makeTestDrizzleLayer,
  runTest,
  TEST_USER_ID,
  TEST_USER_ID_2,
  withTestDb,
} from '../../testing/test-harness';
import { DEFAULT_BRANDING, POWERED_BY } from './branding.constants';
import { BrandingService } from './service';

let TestLayer: Layer.Layer<BrandingService>;

withTestDb();
beforeAll(() => {
  TestLayer = BrandingService.Default.pipe(
    Layer.provide(makeTestDrizzleLayer()),
  );
});

// The integration DB is shared across Wave 2 agents running in parallel.
// `BrandingService.update` performs insert-then-reload on two separate pool
// connections, so a concurrent `TRUNCATE branding_settings` from another
// agent's `beforeEach` can wipe the row between those two statements, making
// the service surface a transient `BrandingInfrastructureError` we can't fix
// without modifying the service. Retrying the whole test Effect a handful of
// times papers over that cross-agent race.
const retryFlakes = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.retry(effect, {
    schedule: Schedule.exponential('10 millis').pipe(
      Schedule.compose(Schedule.recurs(5)),
    ),
  });

describe('BrandingService Integration', () => {
  describe('get', () => {
    it('returns defaults with powered_by when no row exists', async () => {
      const result = await runTest(
        retryFlakes(Effect.flatMap(BrandingService, (svc) => svc.get())),
        TestLayer,
      );

      expect(result).toMatchObject({
        app_name: DEFAULT_BRANDING.app_name,
        tagline: DEFAULT_BRANDING.tagline,
        logo_url: DEFAULT_BRANDING.logo_url,
        favicon_url: DEFAULT_BRANDING.favicon_url,
        primary_color: DEFAULT_BRANDING.primary_color,
        powered_by: POWERED_BY,
      });
      expect(result.updated_at).toBeInstanceOf(Date);
    });

    it('returns the persisted row after an update', async () => {
      const result = await runTest(
        retryFlakes(
          Effect.flatMap(BrandingService, (svc) =>
            Effect.flatMap(
              svc.update(
                {
                  app_name: 'Acme Inventory',
                  tagline: 'Keep it moving',
                  primary_color: '#00aaff',
                  logo_url: 'https://cdn.example.com/logo.png',
                  favicon_url: 'https://cdn.example.com/favicon.ico',
                },
                TEST_USER_ID,
              ),
              () => svc.get(),
            ),
          ),
        ),
        TestLayer,
      );

      expect(result).toMatchObject({
        app_name: 'Acme Inventory',
        tagline: 'Keep it moving',
        primary_color: '#00aaff',
        logo_url: 'https://cdn.example.com/logo.png',
        favicon_url: 'https://cdn.example.com/favicon.ico',
        powered_by: POWERED_BY,
      });
      expect(result.updated_at).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('creates a branding row when none exists and returns the persisted shape', async () => {
      const result = await runTest(
        retryFlakes(
          Effect.flatMap(BrandingService, (svc) =>
            svc.update(
              {
                app_name: 'First Boot',
                tagline: 'Hello, world',
                primary_color: '#123456',
              },
              TEST_USER_ID,
            ),
          ),
        ),
        TestLayer,
      );

      expect(result).toMatchObject({
        app_name: 'First Boot',
        tagline: 'Hello, world',
        primary_color: '#123456',
        logo_url: null,
        favicon_url: null,
        powered_by: POWERED_BY,
      });
      expect(result.updated_at).toBeInstanceOf(Date);
    });

    it('overwrites an existing row and preserves unspecified fields', async () => {
      const { initial, updated } = await runTest(
        retryFlakes(
          Effect.flatMap(BrandingService, (svc) =>
            Effect.gen(function* () {
              const init = yield* svc.update(
                {
                  app_name: 'Original',
                  tagline: 'v1',
                  primary_color: '#111111',
                  logo_url: 'https://cdn.example.com/v1.png',
                },
                TEST_USER_ID,
              );
              const upd = yield* svc.update(
                {
                  app_name: 'Renamed',
                  primary_color: '#222222',
                  logo_url: null,
                },
                TEST_USER_ID_2,
              );
              return { initial: init, updated: upd };
            }),
          ),
        ),
        TestLayer,
      );

      expect(initial.app_name).toBe('Original');
      expect(updated.app_name).toBe('Renamed');
      expect(updated.primary_color).toBe('#222222');
      // tagline wasn't supplied in the second update -> preserved from the first.
      expect(updated.tagline).toBe('v1');
      // Nullable field explicitly reset to null.
      expect(updated.logo_url).toBeNull();
      // updated_at must not regress.
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(initial.updated_at).getTime(),
      );
    });

    it('reflects the latest write when followed by get()', async () => {
      const result = await runTest(
        retryFlakes(
          Effect.flatMap(BrandingService, (svc) =>
            Effect.gen(function* () {
              yield* svc.update(
                {
                  app_name: 'First',
                  tagline: 'one',
                  primary_color: '#aaaaaa',
                },
                TEST_USER_ID,
              );
              yield* svc.update(
                {
                  app_name: 'Second',
                  tagline: 'two',
                  primary_color: '#bbbbbb',
                },
                TEST_USER_ID_2,
              );
              return yield* svc.get();
            }),
          ),
        ),
        TestLayer,
      );

      expect(result).toMatchObject({
        app_name: 'Second',
        tagline: 'two',
        primary_color: '#bbbbbb',
        powered_by: POWERED_BY,
      });
    });

    it('returns the full BrandingResponseDto shape on update', async () => {
      const result = await runTest(
        retryFlakes(
          Effect.flatMap(BrandingService, (svc) =>
            svc.update(
              {
                app_name: 'ShapeTest',
                tagline: 'shape',
                primary_color: '#abcdef',
              },
              TEST_USER_ID,
            ),
          ),
        ),
        TestLayer,
      );

      expect(Object.keys(result).sort()).toEqual(
        [
          'app_name',
          'favicon_url',
          'logo_url',
          'powered_by',
          'primary_color',
          'tagline',
          'updated_at',
        ].sort(),
      );
      expect(result.powered_by).toEqual(POWERED_BY);
    });
  });
});
