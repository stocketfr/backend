import { Effect } from 'effect';
import type { AreaResponseDto } from '@stocket/types/areas';
import type {
  AreaNotFound,
  AreasInfrastructureError,
} from '../areas/areas.errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import {
  InvalidInventoryArea,
  InventoryAreaLocationMismatch,
  InventoryInfrastructureError,
} from './inventory.errors';

export interface InventoryAreaLookup {
  readonly findById: (
    areaId: string,
  ) => Effect.Effect<
    AreaResponseDto,
    AreaNotFound | AreasInfrastructureError | TenantNotResolved
  >;
}

export const getAreaForInventoryLocation = (
  areasService: InventoryAreaLookup,
  areaId: string,
  locationId: string,
): Effect.Effect<
  AreaResponseDto,
  | InvalidInventoryArea
  | InventoryAreaLocationMismatch
  | InventoryInfrastructureError
  | TenantNotResolved
> =>
  areasService.findById(areaId).pipe(
    Effect.catchTag('AreaNotFound', () =>
      Effect.fail(
        new InvalidInventoryArea({
          areaId,
          messageKey: 'inventory.areaNotFound',
        }),
      ),
    ),
    Effect.catchTag('AreasInfrastructureError', (error) =>
      Effect.fail(
        new InventoryInfrastructureError({
          action: 'load inventory area',
          cause: error,
          messageKey: 'inventory.infrastructureFailed',
        }),
      ),
    ),
    Effect.flatMap((area) =>
      area.location_id === locationId
        ? Effect.succeed(area)
        : Effect.fail(
            new InventoryAreaLocationMismatch({
              areaId,
              locationId,
              messageKey: 'inventory.areaLocationMismatch',
            }),
          ),
    ),
  );
