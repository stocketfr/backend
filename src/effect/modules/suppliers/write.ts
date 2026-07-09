import { Effect } from 'effect';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { hasDefinedPatchValues } from '../../platform/effect/pick-defined';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import {
  toSupplierCreateValues,
  toSupplierUpdateValues,
} from './suppliers.utils';
import { toSupplierResponseDto } from './mappers';
import {
  SupplierNotFound,
  type SuppliersInfrastructureError,
} from './suppliers.errors';
import type {
  CreateSupplierDto,
  SupplierCreateValues,
  SupplierEntity,
  SupplierUpdateValues,
  UpdateSupplierDto,
} from './types';

export interface SupplierWriteRepository {
  readonly create: (
    values: SupplierCreateValues,
  ) => Effect.Effect<
    SupplierEntity,
    SuppliersInfrastructureError | TenantNotResolved
  >;
  readonly update: (
    id: string,
    values: SupplierUpdateValues,
  ) => Effect.Effect<
    SupplierEntity | null,
    SuppliersInfrastructureError | TenantNotResolved
  >;
}

interface SupplierWriteWorkflowOptions<GetError, GetContext> {
  readonly repository: SupplierWriteRepository;
  readonly getSupplierOrFail: (
    id: string,
  ) => Effect.Effect<SupplierEntity, GetError, GetContext>;
}

const makeSupplierNotFound = (id: string) =>
  new SupplierNotFound({ id, messageKey: 'suppliers.notFound' });

export const makeSupplierWriteWorkflows = <GetError, GetContext>({
  repository,
  getSupplierOrFail,
}: SupplierWriteWorkflowOptions<GetError, GetContext>) => {
  const create = (dto: CreateSupplierDto) =>
    Effect.map(repository.create(toSupplierCreateValues(dto)), (supplier) =>
      toSupplierResponseDto(supplier),
    );

  const update = (id: string, dto: UpdateSupplierDto) =>
    Effect.gen(function* () {
      const updateData = toSupplierUpdateValues(dto);

      if (!hasDefinedPatchValues(updateData)) {
        const supplier = yield* getSupplierOrFail(id);
        return toSupplierResponseDto(supplier);
      }

      const updated = yield* fromNullOr(
        repository.update(id, updateData),
        () => makeSupplierNotFound(id),
      );

      return toSupplierResponseDto(updated);
    });

  return {
    create,
    update,
  };
};
