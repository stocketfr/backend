import { relations } from 'drizzle-orm';
import {
  categories,
  roles,
  rolePermissions,
  userRoles,
  locations,
  areas,
  suppliers,
  products,
  photos,
  supplierProducts,
  clients,
  orders,
  orderItems,
  inventory,
  stockMovements,
} from './schema';

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parent_id],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  products: many(products),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  userRoles: many(userRoles),
}));

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.role_id],
      references: [roles.id],
    }),
  }),
);

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  role: one(roles, {
    fields: [userRoles.role_id],
    references: [roles.id],
  }),
}));

export const locationsRelations = relations(locations, ({ many }) => ({
  areas: many(areas),
  inventory: many(inventory),
}));

export const areasRelations = relations(areas, ({ one, many }) => ({
  location: one(locations, {
    fields: [areas.location_id],
    references: [locations.id],
  }),
  parent: one(areas, {
    fields: [areas.parent_id],
    references: [areas.id],
    relationName: 'area_parent',
  }),
  children: many(areas, { relationName: 'area_parent' }),
  inventory: many(inventory),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  supplierProducts: many(supplierProducts),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.category_id],
    references: [categories.id],
  }),
  primary_supplier: one(suppliers, {
    fields: [products.primary_supplier_id],
    references: [suppliers.id],
  }),
  photos: many(photos),
  orderItems: many(orderItems),
  inventory: many(inventory),
  stockMovements: many(stockMovements),
}));

export const photosRelations = relations(photos, ({ one }) => ({
  product: one(products, {
    fields: [photos.product_id],
    references: [products.id],
  }),
}));

export const supplierProductsRelations = relations(
  supplierProducts,
  ({ one }) => ({
    supplier: one(suppliers, {
      fields: [supplierProducts.supplier_id],
      references: [suppliers.id],
    }),
  }),
);

export const clientsRelations = relations(clients, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  client: one(clients, {
    fields: [orders.client_id],
    references: [clients.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.order_id],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.product_id],
    references: [products.id],
  }),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  product: one(products, {
    fields: [inventory.product_id],
    references: [products.id],
  }),
  location: one(locations, {
    fields: [inventory.location_id],
    references: [locations.id],
  }),
  area: one(areas, {
    fields: [inventory.area_id],
    references: [areas.id],
  }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, {
    fields: [stockMovements.product_id],
    references: [products.id],
  }),
  fromLocation: one(locations, {
    fields: [stockMovements.from_location_id],
    references: [locations.id],
    relationName: 'from_location',
  }),
  toLocation: one(locations, {
    fields: [stockMovements.to_location_id],
    references: [locations.id],
    relationName: 'to_location',
  }),
  order: one(orders, {
    fields: [stockMovements.order_id],
    references: [orders.id],
  }),
}));
