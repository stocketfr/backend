import { describe, expect, it } from '@effect/vitest';
import {
  toSuperAdminMeResponse,
  toSuperAdminTenantListResponse,
} from './mappers';
import type { TenantListRow } from './types';
import type { UserSession } from '../../platform/auth/user-session';

const tenant = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Acme France',
  slug: 'acme',
  primaryHostname: 'acme.example.com',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies TenantListRow;

const session = {
  session: {
    id: 'session-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    userId: 'user-1',
    expiresAt: new Date('2026-01-02T00:00:00.000Z'),
    token: 'token',
  },
  user: {
    id: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    email: 'admin@example.com',
    emailVerified: true,
    name: 'Ada Admin',
  },
} satisfies UserSession;

describe('superadmin mappers', () => {
  it('maps a session to a me response', () => {
    expect(toSuperAdminMeResponse(session)).toEqual({
      id: 'user-1',
      email: 'admin@example.com',
      name: 'Ada Admin',
      isSuperAdmin: true,
    });
  });

  it('maps tenant rows to API list response timestamps', () => {
    expect(toSuperAdminTenantListResponse([tenant])).toEqual({
      data: [
        {
          id: tenant.id,
          name: 'Acme France',
          slug: 'acme',
          primaryHostname: 'acme.example.com',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
  });
});
