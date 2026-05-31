import { faker } from '@faker-js/faker';
import {
  suppliers,
  supplierProducts,
  type products,
} from '../../effect/platform/db/schema';
import { SEED_CONFIG, withTenant } from './config';
import { buildSupplier, buildSupplierProduct } from './factories';
import { registry } from './registry';

registry.register({
  name: 'suppliers',
  dependencies: [],
  async run(ctx) {
    console.log('Seeding suppliers...');

    const allSuppliers: (typeof suppliers.$inferSelect)[] = [];

    for (let i = 0; i < SEED_CONFIG.suppliers; i++) {
      const [saved] = await ctx.db
        .insert(suppliers)
        .values(withTenant(ctx.tenant, buildSupplier()))
        .returning();
      allSuppliers.push(saved!);
    }

    console.log(`  Created ${allSuppliers.length} suppliers\n`);
    ctx.store.set('suppliers', allSuppliers);
  },
});

registry.register({
  name: 'supplier-products',
  dependencies: ['suppliers', 'products'],
  async run(ctx) {
    console.log('Seeding supplier-product links...');

    const allSuppliers = ctx.store.get(
      'suppliers',
    ) as (typeof suppliers.$inferSelect)[];
    const allProducts = ctx.store.get(
      'products',
    ) as (typeof products.$inferSelect)[];

    const allSupplierProducts: (typeof supplierProducts.$inferSelect)[] = [];
    const usedPairs = new Set<string>();

    for (let i = 0; i < SEED_CONFIG.supplierProducts; i++) {
      const supplier = faker.helpers.arrayElement(allSuppliers);
      const product = faker.helpers.arrayElement(allProducts);
      const pairKey = `${supplier.id}:${product.id}`;

      if (usedPairs.has(pairKey)) continue;
      usedPairs.add(pairKey);

      const attrs = withTenant(
        ctx.tenant,
        buildSupplierProduct(supplier.id, product.id, supplier.name, {
          is_preferred: i < allSuppliers.length,
        }),
      );
      const [saved] = await ctx.db
        .insert(supplierProducts)
        .values(attrs)
        .returning();
      allSupplierProducts.push(saved!);
    }

    console.log(
      `  Created ${allSupplierProducts.length} supplier-product links\n`,
    );
    ctx.store.set('supplier-products', allSupplierProducts);
  },
});
