import { faker } from '@faker-js/faker';
import { ClientStatus } from '@stocket/types/clients';
import { type LocationType } from '@stocket/types/locations';
import {
  type suppliers,
  type products,
  type locations,
  type clients,
  type supplierProducts,
  type inventory,
} from '../../../effect/platform/db/schema';
import { MOCK_USER_ID, YACHT_NAMES } from '../config';

// Each factory returns a partial insert type — compatible with db.insert().values().
// Pass overrides to pin specific fields: buildSupplier({ is_active: false })

export function buildSupplier(
  overrides: Partial<typeof suppliers.$inferInsert> = {},
): typeof suppliers.$inferInsert {
  return {
    name: faker.company.name(),
    contact_person: faker.person.fullName(),
    email: faker.internet.email(),
    phone: faker.phone.number(),
    address: faker.location.streetAddress({ useFullAddress: true }),
    website: faker.internet.url(),
    notes: faker.helpers.maybe(() => faker.lorem.sentence(), {
      probability: 0.3,
    }),
    is_active: faker.helpers.maybe(() => false, { probability: 0.1 }) ?? true,
    ...overrides,
  };
}

export function buildProduct(
  categoryId: string,
  supplierId: string,
  overrides: Partial<typeof products.$inferInsert> = {},
): typeof products.$inferInsert {
  const standardCost = faker.number.float({
    min: 5,
    max: 5000,
    fractionDigits: 2,
  });
  const markupPercentage = faker.number.float({
    min: 10,
    max: 100,
    fractionDigits: 2,
  });
  const standardPrice = standardCost * (1 + markupPercentage / 100);

  return {
    sku: `SKU-${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`,
    name: faker.commerce.productName(),
    description: faker.helpers.maybe(
      () => faker.commerce.productDescription(),
      { probability: 0.7 },
    ),
    category_id: categoryId,
    volume_ml: faker.helpers.maybe(
      () => faker.number.int({ min: 100, max: 5000 }),
      { probability: 0.5 },
    ),
    weight_kg: faker.helpers.maybe(
      () => faker.number.float({ min: 0.1, max: 50, fractionDigits: 3 }),
      { probability: 0.7 },
    ),
    dimensions_cm: faker.helpers.maybe(
      () =>
        `${faker.number.int({ min: 5, max: 100 })}x${faker.number.int({ min: 5, max: 100 })}x${faker.number.int({ min: 5, max: 100 })}`,
      { probability: 0.6 },
    ),
    standard_cost: standardCost,
    standard_price: Number.parseFloat(standardPrice.toFixed(2)),
    markup_percentage: markupPercentage,
    reorder_point: faker.number.int({ min: 0, max: 50 }),
    primary_supplier_id: supplierId,
    supplier_sku: faker.helpers.maybe(
      () => `SUP-${faker.string.alphanumeric({ length: 8, casing: 'upper' })}`,
      { probability: 0.8 },
    ),
    is_active: faker.helpers.maybe(() => false, { probability: 0.1 }) ?? true,
    is_perishable:
      faker.helpers.maybe(() => true, { probability: 0.2 }) ?? false,
    notes: faker.helpers.maybe(() => faker.lorem.sentence(), {
      probability: 0.3,
    }),
    created_by: MOCK_USER_ID,
    updated_by: MOCK_USER_ID,
    ...overrides,
  };
}

export function buildLocation(
  name: string,
  type: LocationType,
  overrides: Partial<typeof locations.$inferInsert> = {},
): typeof locations.$inferInsert {
  return {
    name,
    type,
    address: faker.location.streetAddress({ useFullAddress: true }),
    contact_person: faker.person.fullName(),
    phone: faker.phone.number(),
    is_active: true,
    ...overrides,
  };
}

export function buildClient(
  index: number,
  overrides: Partial<typeof clients.$inferInsert> = {},
): typeof clients.$inferInsert {
  return {
    company_name: faker.company.name(),
    yacht_name: YACHT_NAMES[index % YACHT_NAMES.length],
    contact_person: faker.person.fullName(),
    email: faker.internet.email(),
    phone: faker.helpers.maybe(() => faker.phone.number(), {
      probability: 0.8,
    }),
    billing_address: faker.helpers.maybe(
      () => faker.location.streetAddress({ useFullAddress: true }),
      { probability: 0.7 },
    ),
    default_delivery_address: faker.helpers.maybe(
      () =>
        `${faker.location.streetAddress({ useFullAddress: true })}, Marina Berth ${faker.number.int({ min: 1, max: 200 })}`,
      { probability: 0.6 },
    ),
    account_status: faker.helpers.weightedArrayElement([
      { value: ClientStatus.ACTIVE, weight: 8 },
      { value: ClientStatus.SUSPENDED, weight: 1 },
      { value: ClientStatus.INACTIVE, weight: 1 },
    ]),
    payment_terms: faker.helpers.maybe(
      () =>
        faker.helpers.arrayElement([
          'Net 30',
          'Net 60',
          'COD',
          'Prepaid',
          'Net 15',
        ]),
      { probability: 0.7 },
    ),
    credit_limit: faker.helpers.maybe(
      () => faker.number.float({ min: 5000, max: 500000, fractionDigits: 2 }),
      { probability: 0.5 },
    ),
    notes: faker.helpers.maybe(
      () =>
        faker.helpers.arrayElement([
          'VIP client - priority handling',
          'Requires advance notification for deliveries',
          'Seasonal client - active May through October',
          'Prefers morning deliveries',
          faker.lorem.sentence(),
        ]),
      { probability: 0.4 },
    ),
    ...overrides,
  };
}

export function buildSupplierProduct(
  supplierId: string,
  productId: string,
  supplierName: string,
  overrides: Partial<typeof supplierProducts.$inferInsert> = {},
): typeof supplierProducts.$inferInsert {
  return {
    supplier_id: supplierId,
    product_id: productId,
    supplier_sku: faker.helpers.maybe(
      () =>
        `${supplierName.substring(0, 3).toUpperCase()}-${faker.string.alphanumeric({ length: 6, casing: 'upper' })}`,
      { probability: 0.7 },
    ),
    cost_per_unit: faker.helpers.maybe(
      () => faker.number.float({ min: 1, max: 3000, fractionDigits: 2 }),
      { probability: 0.8 },
    ),
    lead_time_days: faker.helpers.maybe(
      () => faker.number.int({ min: 1, max: 45 }),
      { probability: 0.6 },
    ),
    minimum_order_quantity: faker.helpers.maybe(
      () => faker.number.int({ min: 1, max: 100 }),
      { probability: 0.5 },
    ),
    is_preferred: false,
    ...overrides,
  };
}

export function buildInventory(
  productId: string,
  locationId: string,
  opts: {
    areaId?: string | null;
    isPerishable?: boolean;
    standardCost?: number | null;
  } = {},
  overrides: Partial<typeof inventory.$inferInsert> = {},
): typeof inventory.$inferInsert {
  const receivedDate = faker.date.recent({ days: 90 });

  return {
    product_id: productId,
    location_id: locationId,
    area_id: opts.areaId ?? undefined,
    quantity: faker.number.int({ min: 0, max: 500 }),
    batch_number:
      faker.helpers.maybe(
        () =>
          `BATCH-${faker.date.recent({ days: 30 }).toISOString().slice(0, 10).replace(/-/g, '')}-${faker.string.alphanumeric({ length: 4, casing: 'upper' })}`,
        { probability: 0.4 },
      ) ?? '',
    expiry_date: opts.isPerishable
      ? faker.date.future({ years: 1, refDate: receivedDate })
      : undefined,
    cost_per_unit: opts.standardCost
      ? Number.parseFloat(
          (
            opts.standardCost *
            faker.number.float({ min: 0.85, max: 1.15, fractionDigits: 2 })
          ).toFixed(2),
        )
      : undefined,
    received_date: receivedDate,
    ...overrides,
  };
}
