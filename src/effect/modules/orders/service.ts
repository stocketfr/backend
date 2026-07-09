import { Effect } from 'effect';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toPaginatedResponse } from '@stocket/types/common';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  makeEnsureExistByIds,
  makeEnsureExistsById,
} from '../../platform/effect/existence';
import { ClientsService } from '../clients/service';
import { ProductsService } from '../products/service';
import {
  OrderNotFound,
} from './orders.errors';
import { toOrderResponseDto } from './mappers';
import { OrdersRepository } from './repository';
import type {
  CreateOrderDto,
  OrderQueryDto,
  UpdateOrderDto,
  UpdateOrderStatusDto,
} from './types';
import { makeOrderWriteWorkflows } from './write';

export class OrdersService extends Effect.Service<OrdersService>()(
  '@stocket/effect/orders/OrdersService',
  {
    effect: Effect.gen(function* () {
      const ordersRepository = yield* OrdersRepository;
      const clientsService = yield* ClientsService;
      const productsService = yield* ProductsService;
      const trace = makeServiceTracer({
        serviceName: 'OrdersService',
        module: 'orders',
        layer: 'service',
        entityType: 'order',
      });

      const makeOrderNotFound = (id: string) =>
        new OrderNotFound({ id, messageKey: 'orders.notFound' });

      const getOrderOrFail = (id: string) =>
        fromNullOr(ordersRepository.findByIdWithRelations(id), () =>
          makeOrderNotFound(id),
        );

      const orderWriteWorkflows = makeOrderWriteWorkflows({
        repository: ordersRepository,
        clientExists: clientsService.existsById,
        productExists: productsService.existsById,
        getOrderOrFail,
      });

      const findAllPaginated = (query: OrderQueryDto) =>
        Effect.map(
          ordersRepository.findAllPaginatedWithRelations(query),
          (result) =>
            toPaginatedResponse(result, (order) => toOrderResponseDto(order)),
        ).pipe(trace.span('findAllPaginated'));

      const findOne = (id: string) =>
        Effect.map(getOrderOrFail(id), (order) =>
          toOrderResponseDto(order),
        ).pipe(trace.span('findOne', { attributes: { orderId: id } }));

      const create = (dto: CreateOrderDto, userId: string) =>
        orderWriteWorkflows.create(dto, userId).pipe(
          trace.span('create', {
            attributes: { clientId: dto.client_id, userId },
          }),
        );

      const update = (id: string, dto: UpdateOrderDto) =>
        orderWriteWorkflows
          .update(id, dto)
          .pipe(trace.span('update', { attributes: { orderId: id } }));

      const updateStatus = (id: string, dto: UpdateOrderStatusDto) =>
        orderWriteWorkflows
          .updateStatus(id, dto)
          .pipe(trace.span('updateStatus', { attributes: { orderId: id } }));

      const remove = (id: string) =>
        orderWriteWorkflows
          .delete(id)
          .pipe(trace.span('delete', { attributes: { orderId: id } }));

      const existsById = (id: string) =>
        ordersRepository
          .existsById(id)
          .pipe(trace.span('existsById', { attributes: { orderId: id } }));

      const ensureExistsById = (id: string) =>
        makeEnsureExistsById(
          ordersRepository.existsById,
          makeOrderNotFound,
        )(id).pipe(
          trace.span('ensureExistsById', { attributes: { orderId: id } }),
        );

      const ensureExistByIds = (ids: readonly string[]) =>
        makeEnsureExistByIds(
          ordersRepository.findByIds,
          makeOrderNotFound,
        )(ids).pipe(trace.span('ensureExistByIds'));

      return {
        findAllPaginated,
        findOne,
        create,
        update,
        updateStatus,
        delete: remove,
        existsById,
        ensureExistsById,
        ensureExistByIds,
      };
    }),
    dependencies: [
      OrdersRepository.Default,
      ClientsService.Default,
      ProductsService.Default,
    ],
  },
) {}
