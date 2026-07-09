import { Effect } from 'effect';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import {
  AreaLocationNotFound,
  AreaParentLocationMismatch,
  ParentAreaNotFound,
} from './areas.errors';
import type { AreasInfrastructureError } from './areas.errors';

export interface AreaReferenceInput {
  readonly location_id?: string;
  readonly parent_id?: string | null;
}

export interface AreaParentReference {
  readonly id: string;
  readonly location_id: string;
}

export interface AreaReferenceLookup {
  readonly locationExists: (
    locationId: string,
  ) => Effect.Effect<boolean, AreasInfrastructureError | TenantNotResolved>;
  readonly findParentArea: (
    parentId: string,
  ) => Effect.Effect<
    AreaParentReference | null,
    AreasInfrastructureError | TenantNotResolved
  >;
}

export const validateAreaReferences = ({
  lookup,
  dto,
  currentLocationId,
}: {
  readonly lookup: AreaReferenceLookup;
  readonly dto: AreaReferenceInput;
  readonly currentLocationId?: string;
}): Effect.Effect<
  void,
  | AreaLocationNotFound
  | AreaParentLocationMismatch
  | AreasInfrastructureError
  | ParentAreaNotFound
  | TenantNotResolved
> =>
  Effect.gen(function* () {
    const effectiveLocationId = dto.location_id ?? currentLocationId;

    if (dto.location_id) {
      const locationExists = yield* lookup.locationExists(dto.location_id);
      if (!locationExists) {
        return yield* Effect.fail(
          new AreaLocationNotFound({
            locationId: dto.location_id,
            messageKey: 'areas.locationNotFound',
          }),
        );
      }
    }

    if (dto.parent_id) {
      const parent = yield* lookup.findParentArea(dto.parent_id);
      if (!parent) {
        return yield* Effect.fail(
          new ParentAreaNotFound({
            parentId: dto.parent_id,
            messageKey: 'areas.parentNotFound',
          }),
        );
      }
      if (
        effectiveLocationId !== undefined &&
        parent.location_id !== effectiveLocationId
      ) {
        return yield* Effect.fail(
          new AreaParentLocationMismatch({
            parentId: dto.parent_id,
            locationId: effectiveLocationId,
            messageKey: 'areas.parentLocationMismatch',
          }),
        );
      }
    }
  });
