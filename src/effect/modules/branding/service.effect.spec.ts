/**
 * Canonical `@effect/vitest` example (Wave 0 reference).
 *
 * Why branding?
 *   - Single dependency: `BrandingRepository` — easy to mock, no cross-service
 *     wiring required.
 *   - Tiny public surface (`get`, `update`) — patterns stay visible.
 *   - Keeps `service.spec.ts` intact; this file demonstrates the
 *     migrated shape side-by-side.
 *
 * Patterns demonstrated:
 *   1. `it.effect(name, () => Effect.Effect<unknown, unknown>)` — no
 *      top-level `Effect.runPromise` escape hatch; the test body is
 *      itself an Effect.
 *   2. Layers provided per-test via `Effect.provide(layer)`. Each
 *      test owns its own layer graph so there is no shared mutable state.
 *   3. Service construction via `ServiceClass.DefaultWithoutDependencies` so
 *      only the direct dependency is mocked.
 *
 * See `backend/src/effect/testing/README.md` for when to pick `it.effect`
 * vs plain `it` + `Effect.runPromise`.
 */
import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer } from 'effect';
import {
  BRANDING_SETTINGS_ID,
  DEFAULT_BRANDING,
  POWERED_BY,
} from './branding.constants';
import { BrandingService } from './service';
import { BrandingRepository, type BrandingSettingsRow } from './repository';
import { CurrentRequestContext } from '../../platform/http/request-context';

const tenantRequestContext = {
  requestId: '00000000-0000-4000-8000-000000000099',
  path: '/api/v1/branding',
  method: 'GET' as const,
  ip: null,
  locale: 'en' as const,
  tenantId: '00000000-0000-4000-8000-000000000001',
};

type BrandingEntity = BrandingSettingsRow;

const makeBrandingEntity = (
  overrides: Partial<BrandingEntity> = {},
): BrandingEntity => ({
  id: BRANDING_SETTINGS_ID,
  tenant_id: '00000000-0000-4000-8000-000000000001',
  app_name: 'TestApp',
  tagline: 'Test tagline',
  logo_url: null,
  favicon_url: null,
  primary_color: '#ff0000',
  updated_at: new Date('2026-01-01'),
  updated_by: 'user-1',
  ...overrides,
});

const makeMockRepository = (
  overrides: Partial<BrandingRepository> = {},
): BrandingRepository => ({
  _tag: '@stocket/effect/branding/BrandingRepository',
  findSettings: vi.fn((_tenantId: string) =>
    Effect.succeed(makeBrandingEntity()),
  ),
  upsertSettings: vi.fn().mockReturnValue(Effect.void),
  ...overrides,
});

const serviceLayer = (repository = makeMockRepository()) =>
  BrandingService.DefaultWithoutDependencies.pipe(
    Layer.provide(Layer.succeed(BrandingRepository, repository)),
  );

const requestContextLayer = Layer.succeed(
  CurrentRequestContext,
  tenantRequestContext,
);

describe('BrandingService (it.effect)', () => {
  it.effect('returns stored branding settings', () => {
    const repository = makeMockRepository({
      findSettings: vi.fn((_tenantId: string) =>
        Effect.succeed(makeBrandingEntity()),
      ),
    });
    return Effect.gen(function* () {
      const svc = yield* BrandingService;
      const result = yield* svc.get();
      expect(result).toMatchObject({
        app_name: 'TestApp',
        tagline: 'Test tagline',
        primary_color: '#ff0000',
        powered_by: POWERED_BY,
      });
      expect(repository.findSettings).toHaveBeenCalledWith(
        tenantRequestContext.tenantId,
      );
    }).pipe(
      Effect.provide(serviceLayer(repository)),
      Effect.provide(requestContextLayer),
    );
  });

  it.effect('returns default branding when no record exists', () => {
    const repository = makeMockRepository({
      findSettings: vi.fn((_tenantId: string) => Effect.succeed(null)),
    });
    return Effect.gen(function* () {
      const svc = yield* BrandingService;
      const result = yield* svc.get();
      expect(result).toMatchObject({
        app_name: DEFAULT_BRANDING.app_name,
        powered_by: POWERED_BY,
      });
    }).pipe(
      Effect.provide(serviceLayer(repository)),
      Effect.provide(requestContextLayer),
    );
  });

  it.effect('upserts and reloads on update', () => {
    const repository = makeMockRepository({
      findSettings: vi.fn((_tenantId: string) =>
        Effect.succeed(makeBrandingEntity({ app_name: 'NewName' })),
      ),
    });

    return Effect.gen(function* () {
      const svc = yield* BrandingService;
      const result = yield* svc.update({ app_name: 'NewName' }, 'user-1');
      expect(repository.upsertSettings).toHaveBeenCalledWith(
        tenantRequestContext.tenantId,
        { app_name: 'NewName' },
        'user-1',
      );
      expect(repository.findSettings).toHaveBeenCalledWith(
        tenantRequestContext.tenantId,
      );
      expect(result).toMatchObject({ app_name: 'NewName' });
    }).pipe(
      Effect.provide(serviceLayer(repository)),
      Effect.provide(requestContextLayer),
    );
  });
});
