import type { UserResponseDto } from '@stocket/types/users';
import type { BetterAuthUser } from './types';

export const toUserResponse = (
  user: BetterAuthUser,
  roles: string[],
): UserResponseDto => ({
  id: user.id,
  name: user.name ?? '',
  email: user.email ?? '',
  image: user.image ?? null,
  roles,
  banned: user.banned ?? false,
  banReason: user.banReason ?? null,
  banExpires: user.banExpires ?? null,
  createdAt: user.createdAt,
});
