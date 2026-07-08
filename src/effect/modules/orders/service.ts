import { Effect } from 'effect';
import type { Schema } from 'effect';
import { makeServiceTracer } from '../../platform/observability/service-tracer';
import { toPaginatedResponse } from '@stocket/types/common';
import {
  type CreateOrderSchema,
  OrderStatus,
  type OrderQuerySchema,
  type UpdateOrderSchema,
  type UpdateOrderStatusSchema,
} from '@stocket/types/orders';
import { fromNullOr } from '../../platform/effect/from-null-or';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import {
  makeEnsureExistByIds,
  makeEnsureExistsById,
} from '../../platform/effect/existence';
import { ProductNotFound } from '../products/products.errors';
import { ClientsService } from '../clients/service';
import { ProductsService } from '../products/service';
import {
  CannotDeleteNonDraftOrder,
  ClientNotFound,
  InvalidOrderStatusTransition,
  OrderNotFound,
  type OrdersInfrastructureError,
} from './orders.errors';
import {
  generateOrderPrefix,
  toOrderResponseDto,
  type Order,
} from './orders.utils';
import { getOrderState } from './state/order-state';
import { OrdersRepository } from './repository';

type OrderQueryDto = Schema.Schema.Type<typeof OrderQuerySchema>;
type CreateOrderDto = Schema.Schema.Type<typeof CreateOrderSchema>;
type UpdateOrderDto = Schema.Schema.Type<typeof UpdateOrderSchema>;
type UpdateOrderStatusDto = Schema.Schema.Type<typeof UpdateOrderStatusSchema>;

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

      const validateStatusTransition = (
        order: Order,
        nextStatus: OrderStatus,
      ): Effect.Effect<void, InvalidOrderStatusTransition> =>
        Effect.try({
          try: () => {
            const currentState = getOrderState(order.status);
            const targetState = getOrderState(nextStatus);

            currentState.validateTransition(nextStatus);
            targetState.validateEntry(order);
          },
          catch: () =>
            new InvalidOrderStatusTransition({
              from: order.status,
              to: nextStatus,
              messageKey: 'orders.invalidStatusTransition',
              messageArgs: {
                from: order.status,
                to: nextStatus,
              },
            }),
        });

      const generateOrderNumber = (): Effect.Effect<
        string,
        OrdersInfrastructureError
      > =>
        Effect.map(
          ordersRepository.getNextOrderNumberSequence(),
          (sequence) =>
            `${generateOrderPrefix(new Date())}-${String(sequence).padStart(5, '0')}`,
        );

      const findAllPaginated = (query: OrderQueryDto) =>
        Effect.map(
          ordersRepository.findAllPaginatedWithRelations(query),
          (result) =>
            toPaginatedResponse(result, (order) =>
              toOrderResponseDto(order),
            ),
        ).pipe(trace.span('findAllPaginated'));

      const findOne = (id: string) =>
        Effect.map(getOrderOrFail(id), (order) =>
          toOrderResponseDto(order),
        ).pipe(trace.span('findOne', { attributes: { orderId: id } }));

      const create = (dto: CreateOrderDto, userId: string) =>
        Effect.gen(function* () {
          const clientExists = yield* clientsService.existsById(dto.client_id);
          if (!clientExists) {
            return yield* Effect.fail(
              new ClientNotFound({
                clientId: dto.client_id,
                messageKey: 'orders.clientNotFound',
              }),
            );
          }

          yield* Effect.forEach(dto.items, (item) =>
            Effect.gen(function* () {
              const productExists = yield* productsService.existsById(
                item.product_id,
              );
              if (!productExists) {
                return yield* Effect.fail(
                  new ProductNotFound({
                    productId: item.product_id,
                    messageKey: 'orders.productNotFound',
                  }),
                );
              }
            }),
          );

          const total_amount = dto.items.reduce(
            (sum, item) => sum + item.quantity * item.unit_price,
            0,
          );

          const order_number = yield* generateOrderNumber();

          const orderData = {
            client_id: dto.client_id,
            delivery_address: dto.delivery_address,
            delivery_deadline: dto.delivery_deadline ?? null,
            yacht_name: dto.yacht_name ?? null,
            special_instructions: dto.special_instructions ?? null,
            total_amount,
            created_by: userId,
            status: OrderStatus.DRAFT,
            order_number,
          };

          const items = dto.items.map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.quantity * item.unit_price,
            notes: item.notes ?? null,
          }));
          const order = yield* ordersRepository.createWithItems(
            orderData,
            items,
          );

          yield* Effect.annotateCurrentSpan({ orderId: order.id });

          const orderWithRelations = yield* getOrderOrFail(order.id);
          return toOrderResponseDto(orderWithRelations);
        }).pipe(
          trace.span('create', {
            attributes: { clientId: dto.client_id, userId },
          }),
        );

      const update = (id: string, dto: UpdateOrderDto) =>
        Effect.gen(function* () {
          const order = yield* getOrderOrFail(id);
          const updateData = pickDefined<Order>([
            ['delivery_address', dto.delivery_address],
            ['delivery_deadline', dto.delivery_deadline],
            ['yacht_name', dto.yacht_name],
            ['special_instructions', dto.special_instructions],
            ['assigned_to', dto.assigned_to],
          ]);

          if (!hasDefinedPatchValues(updateData)) {
            return toOrderResponseDto(order);
          }

          yield* ordersRepository.update(id, updateData);

          const updated = yield* getOrderOrFail(id);
          return toOrderResponseDto(updated);
        }).pipe(trace.span('update', { attributes: { orderId: id } }));

      const updateStatus = (id: string, dto: UpdateOrderStatusDto) =>
        Effect.gen(function* () {
          const order = yield* getOrderOrFail(id);

          yield* validateStatusTransition(order, dto.status);

          const updateData: Partial<Order> = { status: dto.status };
          const { timestampField } = getOrderState(dto.status);
          if (timestampField) {
            updateData[timestampField] = new Date();
          }

          yield* ordersRepository.update(id, updateData);

          const updated = yield* getOrderOrFail(id);
          return toOrderResponseDto(updated);
        }).pipe(trace.span('updateStatus', { attributes: { orderId: id } }));

      const remove = (id: string) =>
        Effect.gen(function* () {
          const order = yield* getOrderOrFail(id);
          if (order.status !== OrderStatus.DRAFT) {
            return yield* Effect.fail(
              new CannotDeleteNonDraftOrder({
                orderId: id,
                status: order.status,
                messageKey: 'orders.deleteOnlyDraft',
              }),
            );
          }

          const result = yield* ordersRepository.deleteDraftWithItems(id);
          if (result === 'not_found') {
            return yield* Effect.fail(
              new OrderNotFound({ id, messageKey: 'orders.notFound' }),
            );
          }
          if (result === 'not_draft') {
            return yield* Effect.fail(
              new CannotDeleteNonDraftOrder({
                orderId: id,
                status: order.status,
                messageKey: 'orders.deleteOnlyDraft',
              }),
            );
          }
        }).pipe(trace.span('delete', { attributes: { orderId: id } }));

      const existsById = (id: string) =>
        ordersRepository.existsById(id).pipe(
          trace.span('existsById', { attributes: { orderId: id } }),
        );

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
