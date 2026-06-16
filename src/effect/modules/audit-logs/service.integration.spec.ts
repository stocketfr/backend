import { randomUUID } from 'node:crypto';
import { Effect, Layer } from 'effect';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import {
  getTestDb,
  closeTestDb,
  truncateAll,
  makeTestDrizzleLayer,
} from '../../testing/integration-layer';
import { seedAuditLog, TEST_USER_ID, TEST_USER_ID_2 } from '../../testing/seed';
import type { DrizzleDb } from '../../platform/db/drizzle';
import { AuditLogsService } from './service';

let db: DrizzleDb;
let TestLayer: Layer.Layer<AuditLogsService>;

beforeAll(() => {
  db = getTestDb();
  const dbLayer = makeTestDrizzleLayer();
  TestLayer = AuditLogsService.Default.pipe(Layer.provide(dbLayer));
});

afterAll(() => closeTestDb());
beforeEach(() => truncateAll());

const run = <A, E>(effect: Effect.Effect<A, E, AuditLogsService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

const fail = <A, E>(effect: Effect.Effect<A, E, AuditLogsService>) =>
  Effect.runPromise(Effect.flip(effect.pipe(Effect.provide(TestLayer))));

describe('AuditLogsService Integration', () => {
  describe('findById', () => {
    it('returns an audit log by ID', async () => {
      const log = await seedAuditLog(db, {
        action: AuditAction.CREATE,
        entity_type: AuditEntityType.PRODUCT,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });

      const result = await run(
        Effect.flatMap(AuditLogsService, (svc) => svc.findById(log.id)),
      );

      expect(result.action).toBe(AuditAction.CREATE);
      expect(result.entity_type).toBe(AuditEntityType.PRODUCT);
    });

    it('fails for nonexistent audit log', async () => {
      const error = await fail(
        Effect.flatMap(AuditLogsService, (svc) =>
          svc.findById('00000000-0000-0000-0000-000000000000'),
        ),
      );

      expect(error._tag).toBe('AuditLogNotFound');
    });
  });

  describe('getEntityHistory', () => {
    it('returns all logs for a specific entity', async () => {
      const entityId = randomUUID();
      await seedAuditLog(db, {
        action: AuditAction.CREATE,
        entity_type: AuditEntityType.CLIENT,
        entity_id: entityId,
        user_id: TEST_USER_ID,
      });
      await seedAuditLog(db, {
        action: AuditAction.UPDATE,
        entity_type: AuditEntityType.CLIENT,
        entity_id: entityId,
        user_id: TEST_USER_ID,
      });
      // Different entity — should not appear
      await seedAuditLog(db, {
        action: AuditAction.CREATE,
        entity_type: AuditEntityType.CLIENT,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });

      const result = await run(
        Effect.flatMap(AuditLogsService, (svc) =>
          svc.getEntityHistory(AuditEntityType.CLIENT, entityId),
        ),
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('getUserHistory', () => {
    it('returns all logs for a specific user', async () => {
      await seedAuditLog(db, {
        action: AuditAction.CREATE,
        entity_type: AuditEntityType.PRODUCT,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });
      await seedAuditLog(db, {
        action: AuditAction.UPDATE,
        entity_type: AuditEntityType.SUPPLIER,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });
      // Different user — should not appear
      await seedAuditLog(db, {
        action: AuditAction.DELETE,
        entity_type: AuditEntityType.PRODUCT,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID_2,
      });

      const result = await run(
        Effect.flatMap(AuditLogsService, (svc) =>
          svc.getUserHistory(TEST_USER_ID),
        ),
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('query', () => {
    it('paginates audit logs', async () => {
      for (let i = 0; i < 5; i++) {
        await seedAuditLog(db, {
          action: AuditAction.CREATE,
          entity_type: AuditEntityType.PRODUCT,
          entity_id: randomUUID(),
          user_id: TEST_USER_ID,
        });
      }

      const result = await run(
        Effect.flatMap(AuditLogsService, (svc) =>
          svc.query({ page: 1, limit: 3 } as any),
        ),
      );

      expect(result.data).toHaveLength(3);
      expect(result.meta.total).toBe(5);
    });

    it('filters by entity_type', async () => {
      await seedAuditLog(db, {
        entity_type: AuditEntityType.PRODUCT,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });
      await seedAuditLog(db, {
        entity_type: AuditEntityType.CLIENT,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });

      const result = await run(
        Effect.flatMap(AuditLogsService, (svc) =>
          svc.query({
            page: 1,
            limit: 10,
            entity_type: AuditEntityType.PRODUCT,
          } as any),
        ),
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.entity_type).toBe(AuditEntityType.PRODUCT);
    });

    it('filters by action', async () => {
      await seedAuditLog(db, {
        action: AuditAction.CREATE,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });
      await seedAuditLog(db, {
        action: AuditAction.DELETE,
        entity_id: randomUUID(),
        user_id: TEST_USER_ID,
      });

      const result = await run(
        Effect.flatMap(AuditLogsService, (svc) =>
          svc.query({
            page: 1,
            limit: 10,
            action: AuditAction.DELETE,
          } as any),
        ),
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.action).toBe(AuditAction.DELETE);
    });
  });
});
