import { toUserResponse } from './mappers';
import type { BetterAuthUser } from './types';

describe('users mappers', () => {
  it('maps Better Auth user rows to API user responses with defaults', () => {
    const user: BetterAuthUser = {
      id: 'user-1',
      name: null,
      email: null,
      image: null,
      banned: null,
      banReason: null,
      banExpires: null,
      createdAt: '2026-03-01T00:00:00.000Z',
    };

    expect(toUserResponse(user, ['Admin'])).toEqual({
      id: 'user-1',
      name: '',
      email: '',
      image: null,
      roles: ['Admin'],
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
  });
});
