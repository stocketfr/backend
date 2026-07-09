import { describe, expect, it } from '@effect/vitest';
import { toAreaResponseDto } from './mappers';
import type { Area } from './types';

const createdAt = new Date('2026-01-01T00:00:00.000Z');
const updatedAt = new Date('2026-01-02T00:00:00.000Z');

const makeArea = (overrides: Partial<Area> = {}): Area => ({
  id: '00000000-0000-4000-8000-000000000001',
  tenant_id: '00000000-0000-4000-8000-000000000010',
  location_id: '00000000-0000-4000-8000-000000000002',
  parent_id: null,
  name: 'Dry Storage',
  code: 'DRY',
  description: 'Ambient storage',
  is_active: true,
  created_at: createdAt,
  updated_at: updatedAt,
  ...overrides,
});

describe('area mappers', () => {
  it('maps an area tree to the response contract', () => {
    expect(
      toAreaResponseDto(
        makeArea({
          children: [makeArea({ id: '00000000-0000-4000-8000-000000000003' })],
        }),
      ),
    ).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      location_id: '00000000-0000-4000-8000-000000000002',
      name: 'Dry Storage',
      children: [{ id: '00000000-0000-4000-8000-000000000003' }],
    });
  });
});
