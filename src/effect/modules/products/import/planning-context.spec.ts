import type { AreaResponseDto } from '@stocket/types/areas';
import type { CategoryWithChildrenResponseDto } from '@stocket/types/categories';
import {
  LocationType,
  type LocationResponseDto,
} from '@stocket/types/locations';
import {
  makeProductImportTargetContext,
  PRODUCT_IMPORT_CONTEXT_LIMITS,
} from './planning-context';

const NOW = new Date('2026-07-10T10:00:00.000Z');

const category = (
  id: string,
  name: string,
  children: CategoryWithChildrenResponseDto[] = [],
): CategoryWithChildrenResponseDto => ({
  id,
  name,
  parent_id: null,
  description: null,
  children,
  created_at: NOW,
  updated_at: NOW,
});

const location = (
  id: string,
  name: string,
  isActive = true,
): LocationResponseDto => ({
  id,
  name,
  type: LocationType.WAREHOUSE,
  address: '',
  contact_person: '',
  phone: '',
  is_active: isActive,
  created_at: NOW,
  updated_at: NOW,
});

const area = (
  id: string,
  locationId: string,
  name: string,
  parentId: string | null = null,
  isActive = true,
): AreaResponseDto => ({
  id,
  location_id: locationId,
  parent_id: parentId,
  name,
  code: '',
  description: '',
  is_active: isActive,
  created_at: NOW,
  updated_at: NOW,
});

describe('makeProductImportTargetContext', () => {
  it('flattens nested categories and areas while excluding inactive targets', () => {
    const context = makeProductImportTargetContext(
      [
        category('category-root', 'Consumables', [
          category('category-child', 'Dental'),
        ]),
      ],
      [
        location('warehouse', 'Warehouse'),
        location('inactive-location', 'Closed site', false),
      ],
      [
        area('bay', 'warehouse', 'Bay I'),
        area('shelf', 'warehouse', 'Shelf 3', 'bay'),
        area('inactive-area', 'warehouse', 'Shelf 4', 'bay', false),
        area('orphaned', 'inactive-location', 'Hidden'),
      ],
    );

    expect(context).toEqual({
      categories: [
        { id: 'category-root', path: 'Consumables' },
        { id: 'category-child', path: 'Consumables / Dental' },
      ],
      locations: [
        {
          id: 'warehouse',
          name: 'Warehouse',
          type: LocationType.WAREHOUSE,
        },
      ],
      areas: [
        { id: 'bay', locationId: 'warehouse', path: 'Bay I' },
        {
          id: 'shelf',
          locationId: 'warehouse',
          path: 'Bay I / Shelf 3',
        },
      ],
    });
  });

  it('caps compact LLM context and marks truncation visibly', () => {
    const categories = Array.from(
      { length: PRODUCT_IMPORT_CONTEXT_LIMITS.categories + 1 },
      (_, index) => category(`category-${index}`, `Category ${index}`),
    );
    const locations = Array.from(
      { length: PRODUCT_IMPORT_CONTEXT_LIMITS.locations + 1 },
      (_, index) => location(`location-${index}`, `Location ${index}`),
    );
    const areas = Array.from(
      { length: PRODUCT_IMPORT_CONTEXT_LIMITS.areas + 1 },
      (_, index) => area(`area-${index}`, 'location-0', `Area ${index}`),
    );

    const context = makeProductImportTargetContext(
      categories,
      locations,
      areas,
    );

    expect(context.categories).toHaveLength(
      PRODUCT_IMPORT_CONTEXT_LIMITS.categories,
    );
    expect(context.locations).toHaveLength(
      PRODUCT_IMPORT_CONTEXT_LIMITS.locations,
    );
    expect(context.areas).toHaveLength(PRODUCT_IMPORT_CONTEXT_LIMITS.areas);
    expect(context.truncated).toBe(true);
  });
});
