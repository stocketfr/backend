import {
  toCurrentUserResponse,
  toProfileResponse,
  toSessionClaimsResponse,
} from './mappers';
import { DEFAULT_FEATURE_STATES, PlanKey } from '@stocket/types/features';

describe('auth mappers', () => {
  const session = {
    user: {
      id: 'user-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      image: 'https://example.com/avatar.png',
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-10T12:00:00.000Z'),
      role: 'admin',
    },
    session: {
      id: 'session-1',
      createdAt: new Date('2026-03-10T12:00:00.000Z'),
      expiresAt: new Date('2026-03-17T12:00:00.000Z'),
    },
  } as any;

  it('maps the current user response', () => {
    expect(
      toCurrentUserResponse(
        session,
        {
          roleNames: ['Admin'],
          permissions: {
            roles: ['read', 'write'],
          } as any,
        },
        {
          tenantId: '00000000-0000-4000-8000-000000000001',
          tenantName: 'Stocket',
          tenantSlug: 'stocket',
        },
        {
          planKey: PlanKey.FREE,
          features: DEFAULT_FEATURE_STATES,
        },
      ),
    ).toEqual({
      id: 'user-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      image: 'https://example.com/avatar.png',
      tenantId: '00000000-0000-4000-8000-000000000001',
      tenantName: 'Stocket',
      tenantSlug: 'stocket',
      planKey: PlanKey.FREE,
      features: DEFAULT_FEATURE_STATES,
      roles: ['Admin'],
      permissions: {
        roles: ['read', 'write'],
      },
    });
  });

  it('maps the profile response', () => {
    expect(toProfileResponse(session)).toEqual({
      id: 'user-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      image: 'https://example.com/avatar.png',
      createdAt: '2026-03-01T10:00:00.000Z',
      updatedAt: '2026-03-10T12:00:00.000Z',
    });
  });

  it('maps the session claims response', () => {
    expect(toSessionClaimsResponse(session)).toEqual({
      user_id: 'user-1',
      session_id: 'session-1',
      issued_at: 1773144000,
      expires_at: 1773748800,
    });
  });
});
