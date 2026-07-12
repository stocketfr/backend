import type { AreaResponseDto } from '@stocket/types/areas';

/** Build display paths from the tenant-scoped flat area graph. */
export function buildAreaPathMap(
  areas: readonly AreaResponseDto[],
): ReadonlyMap<string, string> {
  const areasById = new Map(areas.map((area) => [area.id, area]));
  const paths = new Map<string, string>();

  for (const area of areas) {
    const segments: string[] = [];
    const visited = new Set<string>();
    let current: AreaResponseDto | undefined = area;

    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      segments.unshift(current.name);
      current = current.parent_id
        ? areasById.get(current.parent_id)
        : undefined;
    }

    paths.set(area.id, segments.join(' / '));
  }

  return paths;
}
