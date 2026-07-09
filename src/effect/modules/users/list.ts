import type { UserQueryDto, UserResponseDto } from '@stocket/types/users';
import { toUserResponse } from './mappers';
import type { BetterAuthUser } from './types';

export interface UserListWindow {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
}

export interface UserRoleAssignment {
  readonly user_id: string;
  readonly role: {
    readonly name: string;
  };
}

export const resolveUserListWindow = (
  query: Pick<UserQueryDto, 'page' | 'limit'>,
): UserListWindow => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
};

export const groupRoleNamesByUserId = (
  assignments: readonly UserRoleAssignment[],
): Map<string, string[]> => {
  const rolesByUserId = new Map<string, string[]>();
  for (const assignment of assignments) {
    const roleNames = rolesByUserId.get(assignment.user_id) ?? [];
    roleNames.push(assignment.role.name);
    rolesByUserId.set(assignment.user_id, roleNames);
  }
  return rolesByUserId;
};

export const toUserListResponse = ({
  users,
  assignments,
  total,
  page,
  limit,
}: {
  readonly users: readonly BetterAuthUser[];
  readonly assignments: readonly UserRoleAssignment[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}): {
  readonly data: UserResponseDto[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
  readonly total_pages: number;
} => {
  const rolesByUserId = groupRoleNamesByUserId(assignments);

  return {
    data: users.map((user) =>
      toUserResponse(user, rolesByUserId.get(user.id) ?? []),
    ),
    total,
    page,
    limit,
    total_pages: Math.ceil(total / limit),
  };
};
