import { describe, expect, it } from '@effect/vitest';
import { Permission, Resource } from '@stocket/types/auth';
import { toRoleResponseDto } from './mappers';
import type { RoleWithPermissions } from './types';

const now = new Date('2026-01-01T00:00:00.000Z');

const role = {
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  name: 'Manager',
  description: 'Can manage stock',
  is_system: false,
  permissions: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      role_id: '00000000-0000-4000-8000-000000000001',
      resource: Resource.PRODUCTS,
      permission: Permission.WRITE,
    },
  ],
  created_at: now,
  updated_at: now,
} satisfies RoleWithPermissions;

describe('role mappers', () => {
  it('maps role permissions to response permissions', () => {
    expect(toRoleResponseDto(role)).toEqual({
      id: role.id,
      name: 'Manager',
      description: 'Can manage stock',
      is_system: false,
      permissions: [
        {
          resource: Resource.PRODUCTS,
          permission: Permission.WRITE,
        },
      ],
      created_at: now,
      updated_at: now,
    });
  });
});
