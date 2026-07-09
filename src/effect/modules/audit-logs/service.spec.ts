import { type Mock } from 'vitest';
import { Effect, Layer } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import type { auditLogs } from '../../platform/db/schema';
import { AuditLogsService } from './service';
import { AuditLogsRepository } from './repository';

type AuditLogEntity = typeof auditLogs.$inferSelect;

const makeAuditLogEntity = (
  overrides: Partial<AuditLogEntity> = {},
): AuditLogEntity =>
  ({
    id: 'log-1',
    user_id: 'user-1',
    action: AuditAction.CREATE,
    entity_type: AuditEntityType.PRODUCT,
    entity_id: 'entity-1',
    changes: null,
    ip_address: '127.0.0.1',
    user_agent: null,
    created_at: new Date('2026-01-01'),
    ...overrides,
  }) as AuditLogEntity;

const makeMockRepository = (overrides: Record<string, Mock> = {}) => ({
  findPaginated: vi.fn().mockReturnValue(
    Effect.succeed({
      data: [makeAuditLogEntity()],
      total: 1,
      page: 1,
      limit: 20,
      total_pages: 1,
    }),
  ),
  findById: vi.fn().mockReturnValue(Effect.succeed(makeAuditLogEntity())),
  findByEntityId: vi
    .fn()
    .mockReturnValue(Effect.succeed([makeAuditLogEntity()])),
  findByUserId: vi.fn().mockReturnValue(Effect.succeed([makeAuditLogEntity()])),
  ...overrides,
});

const buildService = (repo = makeMockRepository()) =>
  Effect.runPromise(
    AuditLogsService.pipe(
      Effect.provide(
        AuditLogsService.DefaultWithoutDependencies.pipe(
          Layer.provide(Layer.succeed(AuditLogsRepository, repo as any)),
        ),
      ),
    ),
  );

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const fail = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('Effect AuditLogsService', () => {
  it('returns paginated audit logs', async () => {
    const service = await buildService();
    const result = await run(service.query({ page: 1, limit: 20 }));

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      id: 'log-1',
      action: AuditAction.CREATE,
    });
    expect(result.meta.total).toBe(1);
  });

  it('maps joined user names into audit log responses', async () => {
    const repo = makeMockRepository({
      findById: vi.fn().mockReturnValue(
        Effect.succeed({
          ...makeAuditLogEntity(),
          user_name: 'Audit Actor',
        }),
      ),
    });
    const service = await buildService(repo);

    const result = await run(service.findById('log-1'));

    expect(result.user_name).toBe('Audit Actor');
    expect(result).not.toHaveProperty('ip_address');
  });

  it('passes filter options to repository', async () => {
    const repo = makeMockRepository();
    const service = await buildService(repo);

    await run(
      service.query({
        entity_type: AuditEntityType.PRODUCT,
        user_id: 'user-1',
        page: 2,
        limit: 10,
      }),
    );

    expect(repo.findPaginated).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: AuditEntityType.PRODUCT,
        user_id: 'user-1',
        page: 2,
        limit: 10,
      }),
    );
  });

  it('returns a single audit log by ID with a null user name when not joined', async () => {
    const service = await buildService();
    const result = await run(service.findById('log-1'));

    expect(result).toMatchObject({ id: 'log-1', user_name: null });
    expect(result).not.toHaveProperty('ip_address');
  });

  it('fails with AuditLogNotFound when ID does not exist', async () => {
    const repo = makeMockRepository({
      findById: vi.fn().mockReturnValue(Effect.succeed(null)),
    });
    const service = await buildService(repo);

    const error = await fail(service.findById('missing'));
    expect(error).toMatchObject({ _tag: 'AuditLogNotFound' });
  });

  it('returns entity history', async () => {
    const service = await buildService();
    const result = await run(
      service.getEntityHistory(AuditEntityType.PRODUCT, 'entity-1'),
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ entity_id: 'entity-1' });
  });

  it('returns user history', async () => {
    const service = await buildService();
    const result = await run(service.getUserHistory('user-1'));

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ user_id: 'user-1' });
  });
});
