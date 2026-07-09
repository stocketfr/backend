import type { auditLogs } from '../../platform/db/schema';

export type AuditLogRow = typeof auditLogs.$inferSelect;

export type AuditLogRowWithUser = AuditLogRow & {
  readonly user_name: string | null;
};

export type AuditLog = AuditLogRow | AuditLogRowWithUser;
