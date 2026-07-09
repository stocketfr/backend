import { Effect } from 'effect';
import type { SupplierQueryDto } from '@stocket/types/suppliers';
import { toPaginatedResponse } from '@stocket/types/common';
import { makeReferenceEntityOperations } from '../../platform/reference-data-service';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toSupplierResponseDto } from './mappers';
import { SupplierNotFound } from './suppliers.errors';
import { SuppliersRepository } from './repository';
import type { CreateSupplierDto, UpdateSupplierDto } from './types';
import { makeSupplierWriteWorkflows } from './write';

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
        findByIds: (ids: readonly string[]) => repository.findByIds(ids),
        makeNotFound: (id) =>
          new SupplierNotFound({ id, messageKey: 'suppliers.notFound' }),
        toResponse: toSupplierResponseDto,
      });

      const findAllPaginated = (query: SupplierQueryDto) =>
        Effect.map(repository.findAllPaginated(query), (result) =>
          toPaginatedResponse(result, toSupplierResponseDto),
        ).pipe(trace.span('findAllPaginated'));

      const findOne = (id: string) =>
        referenceEntity
          .findOne(id)
          .pipe(trace.span('findOne', { attributes: { id } }));

      const supplierWriteWorkflows = makeSupplierWriteWorkflows({
        repository,
        getSupplierOrFail: referenceEntity.getOrFail,
      });

      const create = (dto: CreateSupplierDto) =>
        supplierWriteWorkflows.create(dto).pipe(trace.span('create'));

      const update = (id: string, dto: UpdateSupplierDto) =>
        supplierWriteWorkflows
          .update(id, dto)
          .pipe(trace.span('update', { attributes: { id } }));

      const remove = (id: string) =>
        referenceEntity
          .remove(id)
          .pipe(trace.span('delete', { attributes: { id } }));

      const existsById = (id: string) =>
        referenceEntity
          .existsById(id)
          .pipe(trace.span('existsById', { attributes: { id } }));

      const ensureExistsById = (id: string) =>
        referenceEntity
          .ensureExistsById(id)
          .pipe(trace.span('ensureExistsById', { attributes: { id } }));

      const ensureExistByIds = (ids: readonly string[]) =>
        referenceEntity
          .ensureExistByIds(ids)
          .pipe(trace.span('ensureExistByIds'));

      return {
        findAllPaginated,
        findOne,
        create,
        update,
        delete: remove,
        existsById,
        ensureExistsById,
        ensureExistByIds,
      };
    }),
    dependencies: [SuppliersRepository.Default],
  },
) {}
