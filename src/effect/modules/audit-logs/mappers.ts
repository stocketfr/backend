import { Schema } from 'effect';
import type { AuditLogResponseDto } from '@stocket/types/audit-logs';
import type { AuditLog } from './types';

const AuditChangesRecordSchema = Schema.Record({
  key: Schema.String,
  value: Schema.Unknown,
});

const AuditChangesSchema = Schema.NullOr(
  Schema.Struct({
    before: Schema.optional(AuditChangesRecordSchema),
    after: Schema.optional(AuditChangesRecordSchema),
  }),
);

const decodeAuditChanges = Schema.decodeUnknownSync(AuditChangesSchema);

export const toAuditLogResponseDto = (
  auditLog: AuditLog,
): AuditLogResponseDto => ({
  id: auditLog.id,
  user_id: auditLog.user_id,
  user_name: 'user_name' in auditLog ? auditLog.user_name : null,
  action: auditLog.action,
  entity_type: auditLog.entity_type,
  entity_id: auditLog.entity_id,
  changes: decodeAuditChanges(auditLog.changes),
  user_agent: auditLog.user_agent,
  created_at: auditLog.created_at,
});
