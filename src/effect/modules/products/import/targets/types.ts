import type { Effect } from 'effect';
import type { LocationType } from '@stocket/types/locations';
import type {
  ImportAreaRow,
  ImportCategoryRow,
  ImportLocationRow,
} from '../types';
import type { ProductsInfrastructureError } from '../../products.errors';
import type { TenantNotResolved } from '../../../../platform/tenancy/tenant-context';

export type ProductImportTargetError =
  | ProductsInfrastructureError
  | TenantNotResolved;

export interface ProductImportTargetRepository {
  readonly findCategoryByNameAndParent: (
    name: string,
    parentId: string | null,
  ) => Effect.Effect<ImportCategoryRow | null, ProductImportTargetError>;
  readonly createCategory: (data: {
    readonly name: string;
    readonly parent_id: string | null;
    readonly description: string;
  }) => Effect.Effect<ImportCategoryRow, ProductImportTargetError>;
  readonly findLocationByName: (
    name: string,
  ) => Effect.Effect<ImportLocationRow | null, ProductImportTargetError>;
  readonly findLocationById: (
    id: string,
  ) => Effect.Effect<ImportLocationRow | null, ProductImportTargetError>;
  readonly createLocation: (data: {
    readonly name: string;
    readonly type: LocationType;
    readonly address: string;
    readonly contact_person: string;
    readonly phone: string;
    readonly is_active: boolean;
  }) => Effect.Effect<ImportLocationRow, ProductImportTargetError>;
  readonly findAreaByNameLocationAndParent: (
    locationId: string,
    name: string,
    parentId: string | null,
  ) => Effect.Effect<ImportAreaRow | null, ProductImportTargetError>;
  readonly createArea: (data: {
    readonly location_id: string;
    readonly parent_id: string | null;
    readonly name: string;
    readonly description: string;
    readonly code: string;
    readonly is_active: boolean;
  }) => Effect.Effect<ImportAreaRow, ProductImportTargetError>;
}

export interface ImportInventoryTarget {
  readonly locationId: string | null;
  readonly areaId: string | null;
}
