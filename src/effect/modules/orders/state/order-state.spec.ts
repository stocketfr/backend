import { OrderStatus } from '@stocket/types/orders';
import { getOrderState } from './order-state';

describe('OrderState', () => {
  describe('getOrderState', () => {
    it.each(Object.values(OrderStatus))(
      'should return a state for %s',
      (status) => {
        const state = getOrderState(status);
        expect(state.status).toBe(status);
      },
    );
  });

  describe('valid transitions', () => {
    const expectedTransitions: Record<OrderStatus, OrderStatus[]> = {
      [OrderStatus.DRAFT]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED]: [
        OrderStatus.SOURCING,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.SOURCING]: [
        OrderStatus.PICKING,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.PICKING]: [
        OrderStatus.PACKED,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.PACKED]: [
        OrderStatus.SHIPPED,
        OrderStatus.ON_HOLD,
        OrderStatus.CANCELLED,
      ],
      [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
      [OrderStatus.DELIVERED]: [],
      [OrderStatus.CANCELLED]: [],
      [OrderStatus.ON_HOLD]: [
        OrderStatus.CONFIRMED,
        OrderStatus.SOURCING,
        OrderStatus.PICKING,
        OrderStatus.PACKED,
        OrderStatus.CANCELLED,
      ],
    };

    it.each(Object.values(OrderStatus))(
      '%s should have the correct valid transitions',
      (status) => {
        const state = getOrderState(status);
        expect([...state.validTransitions]).toEqual(
          expectedTransitions[status],
        );
      },
    );

    it.each(Object.values(OrderStatus))(
      '%s should accept all valid transitions without throwing',
      (status) => {
        const state = getOrderState(status);
        for (const target of expectedTransitions[status]) {
          expect(() => state.validateTransition(target)).not.toThrow();
        }
      },
    );
  });

  describe('invalid transitions', () => {
    it('should throw Error for DRAFT to SHIPPED', () => {
      const state = getOrderState(OrderStatus.DRAFT);
      expect(() => state.validateTransition(OrderStatus.SHIPPED)).toThrow(
        Error,
      );
      expect(() => state.validateTransition(OrderStatus.SHIPPED)).toThrow(
        'Cannot transition from DRAFT to SHIPPED',
      );
    });

    it('should throw for DELIVERED to any status', () => {
      const state = getOrderState(OrderStatus.DELIVERED);
      for (const target of Object.values(OrderStatus)) {
        if (target === OrderStatus.DELIVERED) continue;
        expect(() => state.validateTransition(target)).toThrow(Error);
      }
    });

    it('should throw for CANCELLED to any status', () => {
      const state = getOrderState(OrderStatus.CANCELLED);
      for (const target of Object.values(OrderStatus)) {
        if (target === OrderStatus.CANCELLED) continue;
        expect(() => state.validateTransition(target)).toThrow(Error);
      }
    });
  });

  describe('timestampField', () => {
    it('CONFIRMED state should have timestampField confirmed_at', () => {
      expect(getOrderState(OrderStatus.CONFIRMED).timestampField).toBe(
        'confirmed_at',
      );
    });

    it('SHIPPED state should have timestampField shipped_at', () => {
      expect(getOrderState(OrderStatus.SHIPPED).timestampField).toBe(
        'shipped_at',
      );
    });

    it('DELIVERED state should have timestampField delivered_at', () => {
      expect(getOrderState(OrderStatus.DELIVERED).timestampField).toBe(
        'delivered_at',
      );
    });

    it.each([
      OrderStatus.DRAFT,
      OrderStatus.SOURCING,
      OrderStatus.PICKING,
      OrderStatus.PACKED,
      OrderStatus.CANCELLED,
      OrderStatus.ON_HOLD,
    ])('%s should have null timestampField', (status) => {
      expect(getOrderState(status).timestampField).toBeNull();
    });
  });

  describe('terminal states', () => {
    it('DELIVERED should have no valid transitions', () => {
      expect(
        getOrderState(OrderStatus.DELIVERED).validTransitions,
      ).toHaveLength(0);
    });

    it('CANCELLED should have no valid transitions', () => {
      expect(
        getOrderState(OrderStatus.CANCELLED).validTransitions,
      ).toHaveLength(0);
    });
  });

  describe('validateEntry', () => {
    it('should not throw for any state (default no-op)', () => {
      const mockOrder = { status: OrderStatus.DRAFT } as any;
      for (const status of Object.values(OrderStatus)) {
        expect(() =>
          getOrderState(status).validateEntry(mockOrder),
        ).not.toThrow();
      }
    });
  });
});
