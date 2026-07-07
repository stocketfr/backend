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
import { makeReferenceExistsValidator } from '../../platform/reference-data-service';
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
import { generateOrderPrefix, toOrderResponseDto, type Order } from './orders.utils';
import { getOrderState } from './state/order-state';
import { OrderItemsRepository, OrdersRepository } from './repository';

type OrderQueryDto = Schema.Schema.Type<typeof OrderQuerySchema>;
type CreateOrderDto = Schema.Schema.Type<typeof CreateOrderSchema>;
type UpdateOrderDto = Schema.Schema.Type<typeof UpdateOrderSchema>;
type UpdateOrderStatusDto = Schema.Schema.Type<typeof UpdateOrderStatusSchema>;

export class OrdersService extends Effect.Service<OrdersService>()(
  '@stocket/effect/orders/OrdersService',
  {
    effect: Effect.gen(function* () {
      const ordersRepository = yield* OrdersRepository;
      const orderItemsRepository = yield* OrderItemsRepository;
      const clientsService = yield* ClientsService;
      const productsService = yield* ProductsService;
      const trace = makeServiceTracer({
        serviceName: 'OrdersService',
        module: 'orders',
        layer: 'service',
        entityType: 'order',
      });

      const getOrderOrFail = (id: string) =>
        fromNullOr(ordersRepository.findById(id), () =>
          new OrderNotFound({ id, messageKey: 'orders.notFound' }),
        );

      const ensureClientExists = makeReferenceExistsValidator({
        existsById: (clientId: string) => clientsService.existsById(clientId),
        makeNotFound: (clientId) =>
          new ClientNotFound({
            clientId,
            messageKey: 'orders.clientNotFound',
          }),
      });

      const ensureProductExists = makeReferenceExistsValidator({
        existsById: (productId: string) => productsService.existsById(productId),
        makeNotFound: (productId) =>
          new ProductNotFound({
            productId,
            messageKey: 'orders.productNotFound',
          }),
      });

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
          ordersRepository.findAllPaginated(query),
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
          yield* ensureClientExists(dto.client_id);

          yield* Effect.forEach(dto.items, (item) =>
            ensureProductExists(item.product_id),
          );

          const total_amount = dto.items.reduce(
            (sum, item) => sum + item.quantity * item.unit_price,
            0,
          );

          const order_number = yield* generateOrderNumber();

          const order = yield* ordersRepository.create({
            client_id: dto.client_id,
            delivery_address: dto.delivery_address,
            delivery_deadline: dto.delivery_deadline ?? null,
            yacht_name: dto.yacht_name ?? null,
            special_instructions: dto.special_instructions ?? null,
            total_amount,
            created_by: userId,
            status: OrderStatus.DRAFT,
            order_number,
          });

          yield* Effect.annotateCurrentSpan({ orderId: order.id });

          const items = dto.items.map((item) => ({
            order_id: order.id,
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            subtotal: item.quantity * item.unit_price,
            notes: item.notes ?? null,
          }));
          yield* orderItemsRepository.createMany(items);

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

          if (Object.keys(dto).length === 0) {
            return toOrderResponseDto(order);
          }

          const updateData: Partial<Order> = {};
          if (dto.delivery_address !== undefined) {
            updateData.delivery_address = dto.delivery_address;
          }
          if (dto.delivery_deadline !== undefined) {
            updateData.delivery_deadline = dto.delivery_deadline;
          }
          if (dto.yacht_name !== undefined) {
            updateData.yacht_name = dto.yacht_name;
          }
          if (dto.special_instructions !== undefined) {
            updateData.special_instructions = dto.special_instructions;
          }
          if (dto.assigned_to !== undefined) {
            updateData.assigned_to = dto.assigned_to;
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
          const {timestampField} = getOrderState(dto.status);
          if (timestampField) {
            updateData[timestampField] = new Date() as never;
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

          yield* orderItemsRepository.deleteByOrderId(id);
          yield* ordersRepository.delete(id);
        }).pipe(trace.span('delete', { attributes: { orderId: id } }));

      const existsById = (id: string) =>
        ordersRepository.existsById(id).pipe(
          trace.span('existsById', { attributes: { orderId: id } }),
        );

      return {
        findAllPaginated,
        findOne,
        create,
        update,
        updateStatus,
        delete: remove,
        existsById,
      };
    }),
    dependencies: [OrdersRepository.Default, OrderItemsRepository.Default, ClientsService.Default, ProductsService.Default],
  },
) {}
