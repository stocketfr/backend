import { Schema } from 'effect';
import type { RequestContext } from '../../platform/http/request-context';

export const SuperAdminUserRowSchema = Schema.Struct({
  id: Schema.String,
  email: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
});

export type SuperAdminUserRow = Schema.Schema.Type<
  typeof SuperAdminUserRowSchema
>;

export interface SuperAdminActor {
  readonly userId: string;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface CreateTenantActor extends SuperAdminActor {
  readonly requestContext?: RequestContext;
}

export interface CreateTenantProductImport {
  readonly filename: string;
  readonly content: string;
}

export interface TenantListRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly primaryHostname: string | null;
  readonly createdAt: Date;
}

export interface CreateTenantInput {
  readonly name: string;
  readonly slug: string;
  readonly hostname: string;
  readonly adminUserId: string;
}

export interface PlatformAuditEventInput {
  readonly actorUserId: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly metadata?: Record<string, unknown>;
  readonly ipAddress?: string | null;
  readonly userAgent?: string | null;
}

export interface CreatedTenantResult {
  readonly tenant: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly hostname: string;
  };
  readonly admin: {
    readonly id: string;
  };
}
