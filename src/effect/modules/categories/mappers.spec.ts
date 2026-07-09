import { buildCategoryTree } from './mappers';

const now = new Date('2026-01-01T00:00:00.000Z');

const category = (
  id: string,
  name: string,
  parentId: string | null = null,
): Parameters<typeof buildCategoryTree>[0][number] => ({
  id,
  tenant_id: '00000000-0000-4000-8000-000000000001',
  name,
  parent_id: parentId,
  description: null,
  created_at: now,
  updated_at: now,
});

describe('buildCategoryTree', () => {
  it('nests children below their parent categories', () => {
    const tree = buildCategoryTree([
      category('child-1', 'Child', 'root-1'),
      category('root-1', 'Root'),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      id: 'root-1',
      children: [{ id: 'child-1', name: 'Child' }],
    });
  });

  it('treats orphaned children as roots', () => {
    const tree = buildCategoryTree([
      category('orphan-1', 'Orphan', 'missing-parent'),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({
      id: 'orphan-1',
      children: [],
    });
  });
});
