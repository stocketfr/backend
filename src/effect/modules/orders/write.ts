import { Effect } from 'effect';
import { OrderStatus } from '@stocket/types/orders';
import {
  hasDefinedPatchValues,
  pickDefined,
} from '../../platform/effect/pick-defined';
import { makeEnsureExistsById } from '../../platform/effect/existence';
import { ProductNotFound } from '../products/products.errors';
import type { OrdersRepository } from './repository';
import {
  CannotDeleteNonDraftOrder,
  ClientNotFound,
  OrderNotFound,
} from './orders.errors';
import { generateOrderPrefix } from './orders.utils';
import { toOrderResponseDto } from './mappers';
import {
  buildOrderStatusUpdate,
  validateOrderStatusTransition,
} from './status-transition';
import type {
  CreateOrderDto,
  Order,
  UpdateOrderDto,
  UpdateOrderStatusDto,
} from './types';

export type OrderWriteRepository = Pick<
  OrdersRepository,
  | 'createWithItems'
  | 'deleteDraftWithItems'
  | 'getNextOrderNumberSequence'
  | 'update'
>;

type OrderWithRelations = NonNullable<
  Effect.Effect.Success<ReturnType<OrdersRepository['findByIdWithRelations']>>
>;

interface OrderWriteWorkflowOptions<
  ClientError,
  ClientContext,
  ProductError,
  ProductContext,
  GetOrderError,
  GetOrderContext,
> {
  readonly repository: OrderWriteRepository;
  readonly clientExists: (
    clientId: string,
  ) => Effect.Effect<boolean, ClientError, ClientContext>;
  readonly productExists: (
    productId: string,
  ) => Effect.Effect<boolean, ProductError, ProductContext>;
  readonly getOrderOrFail: (
    id: string,
  ) => Effect.Effect<OrderWithRelations, GetOrderError, GetOrderContext>;
}

export const makeOrderWriteWorkflows = <
  ClientError,
  ClientContext,
  ProductError,
  ProductContext,
  GetOrderError,
  GetOrderContext,
>({
  repository,
  clientExists,
  productExists,
  getOrderOrFail,
}: OrderWriteWorkflowOptions<
  ClientError,
  ClientContext,
  ProductError,
  ProductContext,
  GetOrderError,
  GetOrderContext
>) => {
  const generateOrderNumber = () =>
    Effect.map(
      repository.getNextOrderNumberSequence(),
      (sequence) =>
        `${generateOrderPrefix(new Date())}-${String(sequence).padStart(5, '0')}`,
    );

  const ensureClientExists = makeEnsureExistsById(
    clientExists,
    (clientId) =>
      new ClientNotFound({
        clientId,
        messageKey: 'orders.clientNotFound',
      }),
  );

  const ensureProductExists = makeEnsureExistsById(
    productExists,
    (productId) =>
      new ProductNotFound({
        productId,
        messageKey: 'orders.productNotFound',
      }),
  );

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

      const order = yield* repository.createWithItems(
        {
          client_id: dto.client_id,
          delivery_address: dto.delivery_address,
          delivery_deadline: dto.delivery_deadline ?? null,
          yacht_name: dto.yacht_name ?? null,
          special_instructions: dto.special_instructions ?? null,
          total_amount,
          created_by: userId,
          status: OrderStatus.DRAFT,
          order_number,
        },
        dto.items.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.quantity * item.unit_price,
          notes: item.notes ?? null,
        })),
      );

      yield* Effect.annotateCurrentSpan({ orderId: order.id });

      const orderWithRelations = yield* getOrderOrFail(order.id);
      return toOrderResponseDto(orderWithRelations);
    });

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

      yield* repository.update(id, updateData);

      const updated = yield* getOrderOrFail(id);
      return toOrderResponseDto(updated);
    });

  const updateStatus = (id: string, dto: UpdateOrderStatusDto) =>
    Effect.gen(function* () {
      const order = yield* getOrderOrFail(id);

      yield* validateOrderStatusTransition(order, dto.status);

      yield* repository.update(
        id,
        buildOrderStatusUpdate(dto.status, new Date()),
      );

      const updated = yield* getOrderOrFail(id);
      return toOrderResponseDto(updated);
    });

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

      const result = yield* repository.deleteDraftWithItems(id);
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
    });

  return {
    create,
    update,
    updateStatus,
    delete: remove,
  };
};
