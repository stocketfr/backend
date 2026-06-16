import { Effect } from 'effect';
import type { Schema } from 'effect';
import type { SupplierQueryDto } from '@stocket/types/suppliers';
import type {
  CreateSupplierSchema,
  UpdateSupplierSchema,
} from '@stocket/types/suppliers';
import { toPaginatedResponse } from '@stocket/types/common';
import { fromNullOr } from '../../platform/effect/from-null-or';
import { makeReferenceEntityOperations } from '../../platform/reference-data-service';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toSupplierResponseDto } from './suppliers.utils';
import { SupplierNotFound } from './suppliers.errors';
import { SuppliersRepository } from './repository';

type CreateSupplierDto = Schema.Schema.Type<typeof CreateSupplierSchema>;
type UpdateSupplierDto = Schema.Schema.Type<typeof UpdateSupplierSchema>;

export class SuppliersService extends Effect.Service<SuppliersService>()(
  '@stocket/effect/suppliers/SuppliersService',
  {
    effect: Effect.gen(function* () {
      const repository = yield* SuppliersRepository;
      const trace = makeServiceTracer({
        serviceName: 'SuppliersService',
        module: 'suppliers',
        layer: 'service',
      });

      const referenceEntity = makeReferenceEntityOperations({
        findById: (id: string) => repository.findById(id),
        deleteById: (id: string) => repository.delete(id),
        existsById: (id: string) => repository.existsById(id),
        makeNotFound: (id) =>
          new SupplierNotFound({ id, messageKey: 'suppliers.notFound' }),
        toResponse: toSupplierResponseDto,
      });

      const findAllPaginated = (query: SupplierQueryDto) =>
        Effect.map(
          repository.findAllPaginated(query),
          (result) => toPaginatedResponse(result, toSupplierResponseDto),
        ).pipe(trace.span('findAllPaginated'));

      const findOne = (id: string) =>
        referenceEntity.findOne(id).pipe(
          trace.span('findOne', { attributes: { id } }),
        );

      const create = (dto: CreateSupplierDto) =>
        Effect.map(
          repository.create({
            name: dto.name,
            contact_person: dto.contact_person ?? null,
            email: dto.email ?? null,
            phone: dto.phone ?? null,
            address: dto.address ?? null,
            website: dto.website ?? null,
            notes: dto.notes ?? null,
            is_active: dto.is_active ?? true,
          }),
          toSupplierResponseDto,
        ).pipe(trace.span('create'));

      const update = (id: string, dto: UpdateSupplierDto) =>
        Effect.gen(function* () {
          if (Object.keys(dto).length === 0) {
            const supplier = yield* referenceEntity.getOrFail(id);
            return toSupplierResponseDto(supplier);
          }

          const updated = yield* fromNullOr(
            repository.update(id, dto),
            () => new SupplierNotFound({ id, messageKey: 'suppliers.notFound' }),
          );
          return toSupplierResponseDto(updated);
        }).pipe(trace.span('update', { attributes: { id } }));

      const remove = (id: string) =>
        referenceEntity
          .remove(id)
          .pipe(trace.span('delete', { attributes: { id } }));

      const existsById = (id: string) =>
        referenceEntity.existsById(id).pipe(
          trace.span('existsById', { attributes: { id } }),
        );

      return {
        findAllPaginated,
        findOne,
        create,
        update,
        delete: remove,
        existsById,
      };
    }),
    dependencies: [SuppliersRepository.Default],
  },
) {}
