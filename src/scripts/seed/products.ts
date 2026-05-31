import { faker } from '@faker-js/faker';
import {
  products,
  type categories,
  type suppliers,
} from '../../effect/platform/db/schema';
import { SEED_CONFIG, withTenant } from './config';
import { buildProduct } from './factories';
import { registry } from './registry';

registry.register({
  name: 'products',
  dependencies: ['categories', 'suppliers'],
  async run(ctx) {
    console.log('Seeding products...');

    const allCategories = ctx.store.get(
      'categories',
    ) as (typeof categories.$inferSelect)[];
    const allSuppliers = ctx.store.get(
      'suppliers',
    ) as (typeof suppliers.$inferSelect)[];

    const allProducts: (typeof products.$inferSelect)[] = [];
    const leafCategories = allCategories.filter(
      (cat) => cat.parent_id !== null,
    );

    for (let i = 0; i < SEED_CONFIG.products; i++) {
      const category = faker.helpers.arrayElement(leafCategories);
      const supplier = faker.helpers.arrayElement(allSuppliers);

      const attrs = withTenant(
        ctx.tenant,
        buildProduct(category.id, supplier.id),
      );
      const [saved] = await ctx.db.insert(products).values(attrs).returning();
      allProducts.push(saved!);

      if ((i + 1) % 25 === 0) {
        console.log(`  ${i + 1}/${SEED_CONFIG.products} products...`);
      }
    }

    console.log(`  Created ${allProducts.length} products\n`);
    ctx.store.set('products', allProducts);
  },
});
