import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  decimal,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { ClientStatus } from '@stocket/types/clients';
import {
  EntitlementSource,
  FeatureKey,
  PlanKey,
} from '@stocket/types/features';
import { LocationType } from '@stocket/types/locations';
import { OrderStatus } from '@stocket/types/orders';
import { StockMovementReason } from '@stocket/types/stock-movements';
import { DEFAULT_TENANT_ID } from '../tenancy/tenant-constants';

// ── pgEnums ──────────────────────────────────────────────────────────────

export const locationTypeEnum = pgEnum('locations_type', [
  LocationType.WAREHOUSE,
  LocationType.SUPPLIER,
  LocationType.IN_TRANSIT,
  LocationType.CLIENT,
]);

export const clientStatusEnum = pgEnum('clients_account_status', [
  ClientStatus.ACTIVE,
  ClientStatus.SUSPENDED,
  ClientStatus.INACTIVE,
]);

export const orderStatusEnum = pgEnum('orders_status', [
  OrderStatus.DRAFT,
  OrderStatus.CONFIRMED,
  OrderStatus.SOURCING,
  OrderStatus.PICKING,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.CANCELLED,
  OrderStatus.ON_HOLD,
]);

export const stockMovementReasonEnum = pgEnum('stock_movements_reason', [
  StockMovementReason.PURCHASE_RECEIVE,
  StockMovementReason.SALE,
  StockMovementReason.WASTE,
  StockMovementReason.DAMAGED,
  StockMovementReason.EXPIRED,
  StockMovementReason.COUNT_CORRECTION,
  StockMovementReason.RETURN_FROM_CLIENT,
  StockMovementReason.RETURN_TO_SUPPLIER,
  StockMovementReason.INTERNAL_TRANSFER,
]);

export const auditActionEnum = pgEnum('audit_logs_action', [
  AuditAction.CREATE,
  AuditAction.UPDATE,
  AuditAction.DELETE,
  AuditAction.RESTORE,
  AuditAction.ADJUST_QUANTITY,
  AuditAction.ADD_PHOTO,
  AuditAction.STATUS_CHANGE,
]);

export const auditEntityTypeEnum = pgEnum('audit_logs_entity_type', [
  AuditEntityType.PRODUCT,
  AuditEntityType.CATEGORY,
  AuditEntityType.SUPPLIER,
  AuditEntityType.ORDER,
  AuditEntityType.ORDER_ITEM,
  AuditEntityType.INVENTORY,
  AuditEntityType.LOCATION,
  AuditEntityType.STOCK_MOVEMENT,
  AuditEntityType.PHOTO,
  AuditEntityType.AREA,
  AuditEntityType.CLIENT,
  AuditEntityType.ROLE,
]);

export const tenantPlanKeyEnum = pgEnum('tenant_plan_key', [
  PlanKey.FREE,
  PlanKey.BASE,
  PlanKey.GROWTH,
  PlanKey.ENTERPRISE,
]);

export const tenantEntitlementSourceEnum = pgEnum('tenant_entitlement_source', [
  EntitlementSource.SYSTEM,
  EntitlementSource.MANUAL,
  EntitlementSource.BILLING,
]);

export const tenantFeatureKeyEnum = pgEnum('tenant_feature_key', [
  FeatureKey.SMART_IMPORT,
  FeatureKey.ORDERS,
]);

// ── Tables ───────────────────────────────────────────────────────────────

export const organizations = pgTable(
  'organization',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    metadata: text('metadata'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('organization_slug_unique').on(table.slug)],
);

export const betterAuthUsers = pgTable(
  'user',
  {
    // Better Auth still generates UUID values, but the app stores user ids as
    // text because local RBAC tables and audit logs use opaque auth ids.
    id: text('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    email: text('email').notNull(),
    email_verified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role'),
    banned: boolean('banned'),
    ban_reason: text('ban_reason'),
    ban_expires: timestamp('ban_expires', { withTimezone: true }),
    // Notification locale (better-auth additionalFields). Nullable: existing
    // users fall back to DEFAULT_LOCALE for scheduled sends.
    locale: text('locale'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('user_email_key').on(table.email)],
);

export const betterAuthAccounts = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    account_id: text('account_id').notNull(),
    provider_id: text('provider_id').notNull(),
    user_id: text('user_id')
      .notNull()
      .references(() => betterAuthUsers.id, { onDelete: 'cascade' }),
    access_token: text('access_token'),
    refresh_token: text('refresh_token'),
    id_token: text('id_token'),
    access_token_expires_at: timestamp('access_token_expires_at', {
      withTimezone: true,
    }),
    refresh_token_expires_at: timestamp('refresh_token_expires_at', {
      withTimezone: true,
    }),
    scope: text('scope'),
    password: text('password'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('account_user_id_idx').on(table.user_id)],
);

export const betterAuthSessions = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true }).notNull(),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    user_id: text('user_id')
      .notNull()
      .references(() => betterAuthUsers.id, { onDelete: 'cascade' }),
    impersonated_by: text('impersonated_by'),
    active_organization_id: text('active_organization_id'),
  },
  (table) => [
    uniqueIndex('session_token_key').on(table.token),
    index('session_user_id_idx').on(table.user_id),
  ],
);

export const betterAuthVerifications = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

export const betterAuthInvitations = pgTable(
  'invitation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organization_id: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull(),
    expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    inviter_id: text('inviter_id')
      .notNull()
      .references(() => betterAuthUsers.id, { onDelete: 'cascade' }),
  },
  (table) => [
    index('invitation_email_idx').on(table.email),
    index('invitation_organization_id_idx').on(table.organization_id),
  ],
);

export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    kind: text('kind').notNull(),
    is_primary: boolean('is_primary').notNull().default(false),
    verified_at: timestamp('verified_at', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tenant_domains_hostname_unique').on(table.hostname),
    index('tenant_domains_tenant_id_idx').on(table.tenant_id),
    uniqueIndex('tenant_domains_one_primary_per_tenant_idx')
      .on(table.tenant_id)
      .where(sql`is_primary = true`),
  ],
);

export const superAdmins = pgTable('super_admins', {
  user_id: text('user_id').primaryKey(),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const platformAuditEvents = pgTable(
  'platform_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actor_user_id: text('actor_user_id'),
    action: text('action').notNull(),
    entity_type: text('entity_type').notNull(),
    entity_id: text('entity_id').notNull(),
    metadata: jsonb('metadata'),
    ip_address: text('ip_address'),
    user_agent: text('user_agent'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('platform_audit_events_actor_user_id_idx').on(table.actor_user_id),
    index('platform_audit_events_created_at_idx').on(table.created_at),
  ],
);

export const tenantEntitlementProfiles = pgTable(
  'tenant_entitlement_profiles',
  {
    tenant_id: uuid('tenant_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    plan_key: tenantPlanKeyEnum('plan_key').notNull().default(PlanKey.FREE),
    source: tenantEntitlementSourceEnum('source')
      .notNull()
      .default(EntitlementSource.SYSTEM),
    updated_by: text('updated_by'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('tenant_entitlement_profiles_plan_key_idx').on(table.plan_key),
  ],
);

export const tenantFeatureOverrides = pgTable(
  'tenant_feature_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    feature_key: tenantFeatureKeyEnum('feature_key').notNull(),
    enabled: boolean('enabled').notNull(),
    reason: text('reason'),
    expires_at: timestamp('expires_at', { withTimezone: true }),
    updated_by: text('updated_by'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('tenant_feature_overrides_tenant_feature_unique').on(
      table.tenant_id,
      table.feature_key,
    ),
    index('tenant_feature_overrides_tenant_id_idx').on(table.tenant_id),
    index('tenant_feature_overrides_expires_at_idx').on(table.expires_at),
  ],
);

export const members = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organization_id: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    user_id: text('user_id').notNull(),
    role: text('role').notNull().default('member'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('member_user_organization_unique').on(
      table.user_id,
      table.organization_id,
    ),
    index('member_user_id_idx').on(table.user_id),
    index('member_organization_id_idx').on(table.organization_id),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    parent_id: uuid('parent_id'),
    description: varchar('description', { length: 500 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('categories_tenant_id_idx').on(table.tenant_id)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }),
    is_system: boolean('is_system').notNull().default(false),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('roles_tenant_name_unique').on(table.tenant_id, table.name),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    role_id: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    resource: varchar('resource', { length: 50 }).notNull(),
    permission: varchar('permission', { length: 20 }).notNull(),
  },
  (table) => [
    uniqueIndex('role_permissions_role_resource_permission_unique').on(
      table.role_id,
      table.resource,
      table.permission,
    ),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    user_id: text('user_id').notNull(),
    role_id: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
  },
  (table) => [
    uniqueIndex('user_roles_tenant_user_role_unique').on(
      table.tenant_id,
      table.user_id,
      table.role_id,
    ),
    index('user_roles_user_id_idx').on(table.user_id),
    index('user_roles_tenant_user_id_idx').on(table.tenant_id, table.user_id),
  ],
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    name: varchar('name').notNull(),
    type: locationTypeEnum('type').notNull(),
    address: text('address').notNull().default(''),
    contact_person: varchar('contact_person').notNull().default(''),
    phone: varchar('phone').notNull().default(''),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('locations_tenant_id_idx').on(table.tenant_id)],
);

export const areas = pgTable(
  'areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    location_id: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    parent_id: uuid('parent_id'),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 50 }).notNull().default(''),
    description: text('description').notNull().default(''),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('areas_tenant_id_idx').on(table.tenant_id),
    index('areas_location_id_idx').on(table.location_id),
    index('areas_parent_id_idx').on(table.parent_id),
    index('areas_location_parent_idx').on(table.location_id, table.parent_id),
  ],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    name: varchar('name').notNull(),
    contact_person: varchar('contact_person'),
    email: varchar('email'),
    phone: varchar('phone'),
    address: text('address'),
    website: varchar('website'),
    notes: text('notes'),
    is_active: boolean('is_active').notNull().default(true),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('suppliers_tenant_id_idx').on(table.tenant_id)],
);

export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    sku: varchar('sku', { length: 50 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
    category_id: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    volume_ml: integer('volume_ml'),
    weight_kg: decimal('weight_kg', {
      precision: 10,
      scale: 3,
      mode: 'number',
    }),
    dimensions_cm: varchar('dimensions_cm', { length: 50 }),
    standard_cost: decimal('standard_cost', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    standard_price: decimal('standard_price', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    markup_percentage: decimal('markup_percentage', {
      precision: 6,
      scale: 2,
      mode: 'number',
    }),
    reorder_point: integer('reorder_point').notNull().default(0),
    primary_supplier_id: uuid('primary_supplier_id').references(
      () => suppliers.id,
      {
        onDelete: 'set null',
      },
    ),
    supplier_sku: varchar('supplier_sku', { length: 50 }),
    barcode: varchar('barcode', { length: 100 }),
    unit: varchar('unit', { length: 50 }),
    is_active: boolean('is_active').notNull().default(true),
    is_perishable: boolean('is_perishable').notNull().default(false),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
    created_by: varchar('created_by', { length: 255 }),
    updated_by: varchar('updated_by', { length: 255 }),
    deleted_by: varchar('deleted_by', { length: 255 }),
  },
  (table) => [
    uniqueIndex('products_tenant_sku_unique').on(table.tenant_id, table.sku),
    index('products_deleted_at_idx').on(table.deleted_at),
    index('products_active_deleted_idx').on(table.is_active, table.deleted_at),
    index('products_category_deleted_idx').on(
      table.category_id,
      table.deleted_at,
    ),
  ],
);

export const photos = pgTable(
  'photos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    filename: varchar('filename', { length: 255 }).notNull(),
    mimetype: varchar('mimetype', { length: 100 }).notNull(),
    size: integer('size').notNull(),
    storage_path: varchar('storage_path', { length: 500 }).notNull(),
    display_order: integer('display_order').notNull().default(0),
    uploaded_by: uuid('uploaded_by'),
    source_hash: varchar('source_hash', { length: 64 }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('photos_product_id_idx').on(table.product_id),
    uniqueIndex('photos_product_source_hash_unique')
      .on(table.product_id, table.source_hash)
      .where(sql`${table.source_hash} is not null`),
  ],
);

export const supplierProducts = pgTable('supplier_products', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
  supplier_id: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  product_id: uuid('product_id').notNull(),
  supplier_sku: varchar('supplier_sku'),
  cost_per_unit: decimal('cost_per_unit', {
    precision: 12,
    scale: 2,
    mode: 'number',
  }),
  lead_time_days: integer('lead_time_days'),
  minimum_order_quantity: integer('minimum_order_quantity'),
  is_preferred: boolean('is_preferred').notNull().default(false),
  created_at: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    company_name: varchar('company_name').notNull(),
    yacht_name: varchar('yacht_name'),
    contact_person: varchar('contact_person').notNull(),
    email: varchar('email').notNull(),
    phone: varchar('phone'),
    billing_address: text('billing_address'),
    default_delivery_address: text('default_delivery_address'),
    account_status: clientStatusEnum('account_status')
      .notNull()
      .default(ClientStatus.ACTIVE),
    payment_terms: varchar('payment_terms'),
    credit_limit: decimal('credit_limit', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('clients_tenant_id_idx').on(table.tenant_id),
    index('clients_email_idx').on(table.email),
    index('clients_account_status_idx').on(table.account_status),
  ],
);

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    order_number: varchar('order_number').notNull(),
    client_id: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    status: orderStatusEnum('status').notNull().default(OrderStatus.DRAFT),
    delivery_deadline: timestamp('delivery_deadline', { withTimezone: true }),
    delivery_address: text('delivery_address').notNull(),
    yacht_name: varchar('yacht_name'),
    special_instructions: text('special_instructions'),
    total_amount: decimal('total_amount', {
      precision: 12,
      scale: 2,
      mode: 'number',
    })
      .notNull()
      .default(0),
    assigned_to: uuid('assigned_to'),
    created_by: uuid('created_by').notNull(),
    confirmed_at: timestamp('confirmed_at', { withTimezone: true }),
    shipped_at: timestamp('shipped_at', { withTimezone: true }),
    delivered_at: timestamp('delivered_at', { withTimezone: true }),
    kanban_task_id: varchar('kanban_task_id'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_tenant_order_number_unique').on(
      table.tenant_id,
      table.order_number,
    ),
    index('orders_client_id_idx').on(table.client_id),
    index('orders_status_idx').on(table.status),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    order_id: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),
    quantity: integer('quantity').notNull(),
    unit_price: decimal('unit_price', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }).notNull(),
    subtotal: decimal('subtotal', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }).notNull(),
    notes: text('notes'),
    quantity_picked: integer('quantity_picked').notNull().default(0),
    quantity_packed: integer('quantity_packed').notNull().default(0),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('order_items_order_id_idx').on(table.order_id),
    index('order_items_product_id_idx').on(table.product_id),
  ],
);

export const inventory = pgTable(
  'inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),
    location_id: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    area_id: uuid('area_id').references(() => areas.id, {
      onDelete: 'set null',
    }),
    quantity: integer('quantity').notNull().default(0),
    batch_number: varchar('batch_number').notNull().default(''),
    expiry_date: timestamp('expiry_date', { withTimezone: true }),
    cost_per_unit: decimal('cost_per_unit', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    received_date: timestamp('received_date', { withTimezone: true }),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('inventory_tenant_id_idx').on(table.tenant_id),
    index('inventory_product_id_idx').on(table.product_id),
    index('inventory_location_id_idx').on(table.location_id),
    index('inventory_area_id_idx').on(table.area_id),
    index('inventory_product_location_idx').on(
      table.product_id,
      table.location_id,
    ),
    index('inventory_product_location_area_idx').on(
      table.product_id,
      table.location_id,
      table.area_id,
    ),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    product_id: uuid('product_id')
      .notNull()
      .references(() => products.id),
    from_location_id: uuid('from_location_id').references(() => locations.id),
    to_location_id: uuid('to_location_id').references(() => locations.id),
    quantity: integer('quantity').notNull(),
    reason: stockMovementReasonEnum('reason').notNull(),
    order_id: uuid('order_id').references(() => orders.id),
    reference_number: varchar('reference_number'),
    cost_per_unit: decimal('cost_per_unit', {
      precision: 12,
      scale: 2,
      mode: 'number',
    }),
    kanban_task_id: varchar('kanban_task_id'),
    user_id: uuid('user_id').notNull(),
    notes: text('notes'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('stock_movements_tenant_id_idx').on(table.tenant_id),
    index('stock_movements_product_id_idx').on(table.product_id),
    index('stock_movements_from_location_id_idx').on(table.from_location_id),
    index('stock_movements_to_location_id_idx').on(table.to_location_id),
    index('stock_movements_reason_idx').on(table.reason),
    index('stock_movements_created_at_idx').on(table.created_at),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    user_id: text('user_id'),
    action: auditActionEnum('action').notNull(),
    entity_type: auditEntityTypeEnum('entity_type').notNull(),
    entity_id: uuid('entity_id').notNull(),
    changes: jsonb('changes'),
    ip_address: varchar('ip_address'),
    user_agent: varchar('user_agent'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_logs_tenant_id_idx').on(table.tenant_id),
    index('audit_logs_entity_type_entity_id_idx').on(
      table.entity_type,
      table.entity_id,
    ),
    index('audit_logs_user_id_idx').on(table.user_id),
    index('audit_logs_created_at_idx').on(table.created_at),
  ],
);

export const brandingSettings = pgTable(
  'branding_settings',
  {
    id: integer('id').notNull().default(1),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    app_name: varchar('app_name', { length: 100 }).notNull(),
    tagline: varchar('tagline', { length: 255 }).notNull(),
    logo_url: varchar('logo_url', { length: 500 }),
    favicon_url: varchar('favicon_url', { length: 500 }),
    primary_color: varchar('primary_color', { length: 7 }).notNull(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_by: varchar('updated_by'),
  },
  (table) => [
    primaryKey({
      name: 'branding_settings_tenant_id_id_pk',
      columns: [table.tenant_id, table.id],
    }),
  ],
);

// Per-(category, channel) opt-in/out for a user within a tenant (D5). Absence
// of a row means "use the code default" — see effectivePref. This table also
// powers the audience resolver, hence the (tenant, category, channel) index.
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    user_id: text('user_id').notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    channel: varchar('channel', { length: 20 }).notNull(),
    enabled: boolean('enabled').notNull(),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_preferences_unique').on(
      table.tenant_id,
      table.user_id,
      table.category,
      table.channel,
    ),
    index('notification_preferences_tenant_user_idx').on(
      table.tenant_id,
      table.user_id,
    ),
    index('notification_preferences_audience_idx').on(
      table.tenant_id,
      table.category,
      table.channel,
    ),
  ],
);

// Delivery ledger + dedupe ledger (D8). One row per (recipient, channel) send.
// The partial unique index on dedupe_key makes a concurrent double-send safe;
// scheduled alerts also check it in-window before enqueuing.
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenant_id: uuid('tenant_id').default(DEFAULT_TENANT_ID).notNull(),
    user_id: text('user_id').notNull(),
    event_kind: varchar('event_kind', { length: 50 }).notNull(),
    category: varchar('category', { length: 50 }).notNull(),
    channel: varchar('channel', { length: 20 }).notNull(),
    dedupe_key: text('dedupe_key'),
    status: varchar('status', { length: 20 }).notNull(),
    provider_message_id: text('provider_message_id'),
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    sent_at: timestamp('sent_at', { withTimezone: true }),
  },
  (table) => [
    index('notifications_tenant_user_idx').on(table.tenant_id, table.user_id),
    index('notifications_status_idx').on(table.status),
    uniqueIndex('notifications_dedupe_key_unique')
      .on(table.dedupe_key)
      .where(sql`dedupe_key is not null`),
  ],
);
