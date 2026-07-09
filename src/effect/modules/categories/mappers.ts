import type { CategoryWithChildrenResponseDto } from '@stocket/types/categories';
import type { Category } from './types';

export const buildCategoryTree = (
  categories: Category[],
): CategoryWithChildrenResponseDto[] => {
  const categoryMap = new Map<string, CategoryWithChildrenResponseDto>();
  const roots: CategoryWithChildrenResponseDto[] = [];

  for (const category of categories) {
    categoryMap.set(category.id, {
      id: category.id,
      name: category.name,
      parent_id: category.parent_id,
      description: category.description,
      created_at: category.created_at,
      updated_at: category.updated_at,
      children: [],
    });
  }

  for (const category of categories) {
    const node = categoryMap.get(category.id)!;
    if (category.parent_id && categoryMap.has(category.parent_id)) {
      const parent = categoryMap.get(category.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
};
