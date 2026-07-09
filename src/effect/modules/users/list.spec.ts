import {
  groupRoleNamesByUserId,
  resolveUserListWindow,
  toUserListResponse,
} from './list';
import type { BetterAuthUser } from './types';

const user = (overrides: Partial<BetterAuthUser> = {}): BetterAuthUser => ({
  id: 'user-1',
  name: 'Test User',
  email: 'test@example.com',
  image: null,
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('users list helpers', () => {
  it('resolves default and explicit pagination windows', () => {
    expect(resolveUserListWindow({})).toEqual({
      page: 1,
      limit: 20,
      offset: 0,
    });

    expect(resolveUserListWindow({ page: 3, limit: 10 })).toEqual({
      page: 3,
      limit: 10,
      offset: 20,
    });
  });

  it('groups role names by user id in assignment order', () => {
    expect(
      groupRoleNamesByUserId([
        { user_id: 'user-1', role: { name: 'Admin' } },
        { user_id: 'user-2', role: { name: 'Viewer' } },
        { user_id: 'user-1', role: { name: 'Editor' } },
      ]),
    ).toEqual(
      new Map([
        ['user-1', ['Admin', 'Editor']],
        ['user-2', ['Viewer']],
      ]),
    );
  });

  it('maps users and role assignments into a paginated response', () => {
    expect(
      toUserListResponse({
        users: [user(), user({ id: 'user-2', name: null })],
        assignments: [
          { user_id: 'user-1', role: { name: 'Admin' } },
          { user_id: 'user-1', role: { name: 'Editor' } },
        ],
        total: 25,
        page: 2,
        limit: 10,
      }),
    ).toEqual({
      data: [
        expect.objectContaining({
          id: 'user-1',
          name: 'Test User',
          roles: ['Admin', 'Editor'],
        }),
        expect.objectContaining({
          id: 'user-2',
          name: '',
          roles: [],
        }),
      ],
      total: 25,
      page: 2,
      limit: 10,
      total_pages: 3,
    });
  });
});
