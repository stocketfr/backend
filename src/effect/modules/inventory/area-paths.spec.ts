import { describe, expect, it } from 'vitest';
import type { AreaResponseDto } from '@stocket/types/areas';
import { buildAreaPathMap } from './area-paths';

const area = (
  id: string,
  name: string,
  parentId: string | null,
): AreaResponseDto => ({
  id,
  location_id: '00000000-0000-4000-8000-000000000001',
  parent_id: parentId,
  name,
  code: '',
  description: '',
  is_active: true,
  created_at: new Date('2026-07-12T00:00:00.000Z'),
  updated_at: new Date('2026-07-12T00:00:00.000Z'),
});

describe('buildAreaPathMap', () => {
  it('builds the complete path for nested imported areas', () => {
    const paths = buildAreaPathMap([
      area('bay-e', 'Bay E', null),
      area('shelf-3', 'Shelf 3', 'bay-e'),
      area('bin-1', 'Bin 1', 'shelf-3'),
    ]);

    expect(paths.get('shelf-3')).toBe('Bay E / Shelf 3');
    expect(paths.get('bin-1')).toBe('Bay E / Shelf 3 / Bin 1');
  });
});
