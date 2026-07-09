import { describe, expect, it } from '@effect/vitest';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { toAuditLogResponseDto } from './mappers';
import type { AuditLogRow, AuditLogRowWithUser } from './types';

const now = new Date('2026-03-01T00:00:00.000Z');

const makeAuditLog = (overrides: Partial<AuditLogRow> = {}): AuditLogRow => ({
  id: 'log-1',
  tenant_id: '00000000-0000-4000-8000-000000000001',
  user_id: 'user-1',
  action: AuditAction.UPDATE,
  entity_type: AuditEntityType.PRODUCT,
  entity_id: 'entity-1',
  changes: null,
  ip_address: '127.0.0.1',
  user_agent: 'Vitest',
  created_at: now,
  ...overrides,
});

describe('audit log mappers', () => {
  it('maps plain audit log rows with null user name', () => {
    const response = toAuditLogResponseDto(makeAuditLog());

    expect(response).toEqual({
      id: 'log-1',
      user_id: 'user-1',
      user_name: null,
      action: AuditAction.UPDATE,
      entity_type: AuditEntityType.PRODUCT,
      entity_id: 'entity-1',
      changes: null,
      user_agent: 'Vitest',
      created_at: now,
    });
  });

  it('maps joined user names', () => {
    const row: AuditLogRowWithUser = {
      ...makeAuditLog(),
      user_name: 'Audit Actor',
    };

    const response = toAuditLogResponseDto(row);

    expect(response.user_name).toBe('Audit Actor');
  });

  it('decodes before and after change payloads', () => {
    const response = toAuditLogResponseDto(
      makeAuditLog({
        changes: {
          before: { name: 'Old' },
          after: { name: 'New', active: true },
        },
      }),
    );

    expect(response.changes).toEqual({
      before: { name: 'Old' },
      after: { name: 'New', active: true },
    });
  });
});
