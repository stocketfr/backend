import { faker } from '@faker-js/faker';
import { categories } from '../../effect/platform/db/schema';
import { SEED_CONFIG, YACHT_CATEGORIES, withTenant } from './config';
import { registry } from './registry';

registry.register({
  name: 'categories',
  dependencies: [],
  async run(ctx) {
    console.log('Seeding categories...');

    const allCategories: (typeof categories.$inferSelect)[] = [];
    const rootCategories = YACHT_CATEGORIES.root.slice(
      0,
      SEED_CONFIG.categories.root,
    );

    for (const categoryName of rootCategories) {
      const [saved] = await ctx.db
        .insert(categories)
        .values(
          withTenant(ctx.tenant, {
            name: categoryName,
            description: faker.commerce.productDescription(),
            parent_id: null,
          }),
        )
        .returning();
      allCategories.push(saved!);

      const childNames =
        YACHT_CATEGORIES.children[
          categoryName as keyof typeof YACHT_CATEGORIES.children
        ] ||
        Array(SEED_CONFIG.categories.children)
          .fill(null)
          .map(() => faker.commerce.department());

      for (const childName of childNames.slice(
        0,
        SEED_CONFIG.categories.children,
      )) {
        const [savedChild] = await ctx.db
          .insert(categories)
          .values(
            withTenant(ctx.tenant, {
              name: childName,
              description: faker.commerce.productDescription(),
              parent_id: saved!.id,
            }),
          )
          .returning();
        allCategories.push(savedChild!);
      }
    }

    console.log(
      `  Created ${allCategories.length} categories (${rootCategories.length} root + ${allCategories.length - rootCategories.length} children)\n`,
    );

    ctx.store.set('categories', allCategories);
  },
});
