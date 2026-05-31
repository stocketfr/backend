import { faker } from '@faker-js/faker';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { OrderStatus } from '@stocket/types/orders';
import {
  auditLogs,
  type categories,
  type locations,
  type orders,
  type products,
  type suppliers,
} from '../../effect/platform/db/schema';
import { MOCK_USER_ID, SEED_CONFIG, withTenant } from './config';
import { registry } from './registry';

registry.register({
  name: 'audit-logs',
  dependencies: ['products', 'categories', 'suppliers', 'orders', 'locations'],
  async run(ctx) {
    console.log('Seeding audit logs...');

    const allProducts = ctx.store.get(
      'products',
    ) as (typeof products.$inferSelect)[];
    const allCategories = ctx.store.get(
      'categories',
    ) as (typeof categories.$inferSelect)[];
    const allSuppliers = ctx.store.get(
      'suppliers',
    ) as (typeof suppliers.$inferSelect)[];
    const allOrders = ctx.store.get('orders') as (typeof orders.$inferSelect)[];
    const allLocations = ctx.store.get(
      'locations',
    ) as (typeof locations.$inferSelect)[];

    const logs: (typeof auditLogs.$inferSelect)[] = [];

    const entityPool: { type: AuditEntityType; id: string }[] = [
      ...allProducts.map((p) => ({ type: AuditEntityType.PRODUCT, id: p.id })),
      ...allCategories.map((c) => ({
        type: AuditEntityType.CATEGORY,
        id: c.id,
      })),
      ...allSuppliers.map((s) => ({
        type: AuditEntityType.SUPPLIER,
        id: s.id,
      })),
      ...allOrders.map((o) => ({ type: AuditEntityType.ORDER, id: o.id })),
      ...allLocations.map((l) => ({
        type: AuditEntityType.LOCATION,
        id: l.id,
      })),
    ];

    for (let i = 0; i < SEED_CONFIG.auditLogs; i++) {
      const entity = faker.helpers.arrayElement(entityPool);

      const action = faker.helpers.weightedArrayElement([
        { value: AuditAction.CREATE, weight: 4 },
        { value: AuditAction.UPDATE, weight: 5 },
        { value: AuditAction.DELETE, weight: 1 },
        { value: AuditAction.STATUS_CHANGE, weight: 2 },
      ]);

      let changes: {
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
      } | null = null;

      if (action === AuditAction.UPDATE) {
        if (entity.type === AuditEntityType.PRODUCT) {
          changes = {
            before: {
              standard_price: faker.number.float({
                min: 10,
                max: 500,
                fractionDigits: 2,
              }),
            },
            after: {
              standard_price: faker.number.float({
                min: 10,
                max: 500,
                fractionDigits: 2,
              }),
            },
          };
        } else if (entity.type === AuditEntityType.ORDER) {
          const oldStatus = faker.helpers.arrayElement(
            Object.values(OrderStatus),
          );
          changes = {
            before: { status: oldStatus },
            after: {
              status: faker.helpers.arrayElement(
                Object.values(OrderStatus).filter((s) => s !== oldStatus),
              ),
            },
          };
        } else {
          changes = {
            before: { name: faker.commerce.productName() },
            after: { name: faker.commerce.productName() },
          };
        }
      } else if (action === AuditAction.CREATE) {
        changes = { after: { name: faker.commerce.productName() } };
      }

      const [saved] = await ctx.db
        .insert(auditLogs)
        .values(
          withTenant(ctx.tenant, {
            user_id: MOCK_USER_ID,
            action,
            entity_type: entity.type,
            entity_id: entity.id,
            changes,
            ip_address: faker.internet.ipv4(),
            user_agent: faker.helpers.arrayElement([
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
            ]),
          }),
        )
        .returning();
      logs.push(saved!);
    }

    console.log(`  Created ${logs.length} audit logs\n`);
    ctx.store.set('audit-logs', logs);
  },
});
