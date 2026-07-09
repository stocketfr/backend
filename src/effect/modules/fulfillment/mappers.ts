import type { OrderFulfillmentView } from '@stocket/types/fulfillment';
import type { Order } from '../orders/types';

export const toFulfillmentView = (order: Order): OrderFulfillmentView => ({
  orderId: order.id,
  status: order.status,
  confirmedAt: order.confirmed_at,
  shippedAt: order.shipped_at,
  deliveredAt: order.delivered_at,
  items: (order.items ?? []).map((item) => ({
    orderItemId: item.id,
    productId: item.product_id,
    quantity: item.quantity,
    quantityPicked: item.quantity_picked,
    quantityPacked: item.quantity_packed,
  })),
});
