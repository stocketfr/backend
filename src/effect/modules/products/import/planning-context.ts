import { Effect } from 'effect';
import type { AreaResponseDto } from '@stocket/types/areas';
import type { CategoryWithChildrenResponseDto } from '@stocket/types/categories';
import type { LocationResponseDto } from '@stocket/types/locations';
import type {
  ProductImportAreaTargetDto,
  ProductImportCategoryTargetDto,
  ProductImportTargetContextDto,
} from '@stocket/types/products';
import { AreasService } from '../../areas/service';
import { CategoriesService } from '../../categories/service';
import { LocationsService } from '../../locations/service';
import { makeServiceTracer } from '../../../platform/observability/service-tracer';

export const PRODUCT_IMPORT_CONTEXT_LIMITS = {
  categories: 500,
  locations: 200,
  areas: 2_000,
};

const mapEntry = <K, V>(key: K, value: V): readonly [K, V] => [key, value];

const comparePathAndId = (
  left: { readonly id: string; readonly path: string },
  right: { readonly id: string; readonly path: string },
) =>
  left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }) ||
  left.id.localeCompare(right.id);

const flattenCategoryTargets = (
  categories: readonly CategoryWithChildrenResponseDto[],
  parentPath = '',
): ProductImportCategoryTargetDto[] =>
  categories.flatMap((category) => {
    const path = parentPath
      ? `${parentPath} / ${category.name}`
      : category.name;
    return [
      { id: category.id, path },
      ...flattenCategoryTargets(category.children, path),
    ];
  });

const makeAreaPath = (
  area: AreaResponseDto,
  areasById: ReadonlyMap<string, AreaResponseDto>,
): string => {
  const names: string[] = [];
  const visited = new Set<string>();
  let current: AreaResponseDto | undefined = area;

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    names.push(current.name);
    current = current.parent_id ? areasById.get(current.parent_id) : undefined;
  }

  return names.reverse().join(' / ');
};

export const makeProductImportTargetContext = (
  categories: readonly CategoryWithChildrenResponseDto[],
  locations: readonly LocationResponseDto[],
  areas: readonly AreaResponseDto[],
): ProductImportTargetContextDto => {
  const allCategoryTargets =
    flattenCategoryTargets(categories).sort(comparePathAndId);
  const activeLocations = locations
    .filter((location) => location.is_active)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, undefined, {
          sensitivity: 'base',
        }) || left.id.localeCompare(right.id),
    );
  const selectedLocations = activeLocations.slice(
    0,
    PRODUCT_IMPORT_CONTEXT_LIMITS.locations,
  );
  const selectedLocationIds = new Set(
    selectedLocations.map((location) => location.id),
  );
  const allActiveLocationIds = new Set(
    activeLocations.map((location) => location.id),
  );
  const areasById = new Map(areas.map((area) => mapEntry(area.id, area)));
  const allActiveAreaTargets = areas
    .filter(
      (area) => area.is_active && allActiveLocationIds.has(area.location_id),
    )
    .map(
      (area): ProductImportAreaTargetDto => ({
        id: area.id,
        locationId: area.location_id,
        path: makeAreaPath(area, areasById),
      }),
    )
    .sort(comparePathAndId);
  const selectedAreas = allActiveAreaTargets
    .filter((area) => selectedLocationIds.has(area.locationId))
    .slice(0, PRODUCT_IMPORT_CONTEXT_LIMITS.areas);
  const selectedCategories = allCategoryTargets.slice(
    0,
    PRODUCT_IMPORT_CONTEXT_LIMITS.categories,
  );

  return {
    categories: selectedCategories,
    locations: selectedLocations.map(({ id, name, type }) => ({
      id,
      name,
      type,
    })),
    areas: selectedAreas,
    ...(selectedCategories.length < allCategoryTargets.length ||
    selectedLocations.length < activeLocations.length ||
    selectedAreas.length < allActiveAreaTargets.length
      ? { truncated: true }
      : {}),
  };
};

export class ProductImportPlanningContext extends Effect.Service<ProductImportPlanningContext>()(
  '@stocket/effect/products/ProductImportPlanningContext',
  {
    effect: Effect.gen(function* () {
      const categoriesService = yield* CategoriesService;
      const locationsService = yield* LocationsService;
      const areasService = yield* AreasService;
      const trace = makeServiceTracer({
        serviceName: 'ProductImportPlanningContext',
        module: 'products',
        layer: 'service',
      });

      const load = () =>
        Effect.all(
          [
            categoriesService.findAll(),
            locationsService.findAll(),
            areasService.findAll({}),
          ],
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.map(([categories, locations, areas]) =>
            makeProductImportTargetContext(categories, locations, areas),
          ),
          trace.span('load'),
        );

      return { load };
    }),
    dependencies: [
      CategoriesService.Default,
      LocationsService.Default,
      AreasService.Default,
    ],
  },
) {}
