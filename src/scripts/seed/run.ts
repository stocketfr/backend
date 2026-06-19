import { clearDatabase } from './config';
import { registry } from './registry';
import type { SeedContext } from './seeder.interface';

// Import seeders - each file self-registers via registry.register().
import './categories';
import './suppliers';
import './products';
import './product-photos';
import './locations';
import './clients';
import './inventory';
import './orders';
import './stock-movements';
import './audit-logs';

export async function seedTenantData(ctx: SeedContext): Promise<void> {
  await clearDatabase(ctx.db, ctx.tenant.id);
  await registry.runAll(ctx);
}
