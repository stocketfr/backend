import { HttpServerRequest } from '@effect/platform';
import { describe, expect, it, vi } from '@effect/vitest';
import { type Context, Effect, Layer, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { SortOrder } from '@stocket/types/common';
import {
  ProductSortField,
  type ProductResponseDto,
} from '@stocket/types/products';
import { AuditLogWriter } from '../../../platform/audit';
import {
  PermissionProvider,
  type UserPermissions,
} from '../../../platform/auth/permission-provider';
import {
  CurrentRequestActor,
  type RequestActor,
} from '../../../platform/auth/request-actor';
import { CurrentRequestContext } from '../../../platform/http/request-context';
import { makeBetterAuthTestLayer } from '../../../testing/better-auth-test';
import { makeTestLayer } from '../../../testing/utils';
import { ProductsService } from '../../products/service';
import { McpInvocation } from '../types';
import { productMcpRegistry } from './index';
import {
  GetProductResultSchema,
  ListProductsResultSchema,
  ProductMutationResultSchema,
} from './schemas';

const PRODUCT_ID = '00000000-0000-4000-8000-000000000201';
const CATEGORY_ID = '00000000-0000-4000-8000-000000000202';
const SUPPLIER_ID = '00000000-0000-4000-8000-000000000203';
const USER_ID = '00000000-0000-4000-8000-000000000204';
const TENANT_ID = '00000000-0000-4000-8000-000000000205';

const product = (
  overrides: Partial<ProductResponseDto> = {},
): ProductResponseDto => ({
  id: PRODUCT_ID,
  sku: 'SKU-201',
  name: 'Green Widget',
  description: 'A useful widget',
  category_id: CATEGORY_ID,
  category: {
    id: CATEGORY_ID,
    name: 'Widgets',
    parent_id: null,
  },
  volume_ml: 250,
  weight_kg: 1.5,
  dimensions_cm: '10x20x30',
  standard_cost: 10,
  standard_price: 20,
  markup_percentage: 100,
  reorder_point: 5,
  primary_supplier_id: SUPPLIER_ID,
  primary_supplier: {
    id: SUPPLIER_ID,
    name: 'Widget Supply',
  },
  supplier_sku: 'SUP-201',
  barcode: '1234567890123',
  unit: 'piece',
  is_active: true,
  is_perishable: false,
  notes: 'Keep dry',
  created_at: new Date('2026-07-01T10:00:00.000Z'),
  updated_at: new Date('2026-07-02T11:00:00.000Z'),
  deleted_at: null,
  ...overrides,
});

const actor: RequestActor = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  tenantName: 'Test workspace',
  tenantSlug: 'test-workspace',
};

const permissions = (...grants: Permission[]): UserPermissions => ({
  roleNames: ['test-role'],
  permissions: {
    [Resource.PRODUCTS]: grants,
  },
});

const requestLayer = Layer.succeed(
  HttpServerRequest.HttpServerRequest,
  HttpServerRequest.fromWeb(
    new Request('https://test-workspace.example.com/api/v1/mcp', {
      method: 'POST',
    }),
  ),
);

interface HarnessOptions {
  readonly products: Partial<Context.Tag.Service<typeof ProductsService>>;
  readonly userPermissions?: UserPermissions;
}

const makeHarness = ({
  products,
  userPermissions = permissions(Permission.READ, Permission.WRITE),
}: HarnessOptions) => {
  const getPermissionsForUser = vi.fn(() => Effect.succeed(userPermissions));
  const log = vi.fn(() => Effect.void);

  const layer = Layer.mergeAll(
    makeTestLayer(ProductsService)(products),
    makeTestLayer(PermissionProvider)({ getPermissionsForUser }),
    makeTestLayer(AuditLogWriter)({ log }),
    Layer.succeed(CurrentRequestActor, actor),
    Layer.succeed(CurrentRequestContext, {
      requestId: '00000000-0000-4000-8000-000000000206',
      path: '/api/v1/mcp',
      method: 'POST',
      ip: null,
      locale: 'en',
      tenantId: TENANT_ID,
      tenantName: actor.tenantName,
      tenantSlug: actor.tenantSlug,
    }),
    Layer.succeed(McpInvocation, {
      requestConfirmation: () => Effect.succeed('unavailable'),
    }),
    makeBetterAuthTestLayer(),
    requestLayer,
  );

  return {
    execute: (name: string, input: unknown) =>
      productMcpRegistry.execute(name, input).pipe(Effect.provide(layer)),
    getPermissionsForUser,
    log,
  };
};

const decodeListResult = (result: {
  readonly structuredContent?: Record<string, unknown>;
}) => Schema.decodeUnknown(ListProductsResultSchema)(result.structuredContent);

const decodeGetResult = (result: {
  readonly structuredContent?: Record<string, unknown>;
}) => Schema.decodeUnknown(GetProductResultSchema)(result.structuredContent);

const decodeMutationResult = (result: {
  readonly structuredContent?: Record<string, unknown>;
}) =>
  Schema.decodeUnknown(ProductMutationResultSchema)(result.structuredContent);

describe('MCP product CRUD handlers', () => {
  it.effect(
    'lists products with READ permission and maps the query and page',
    () => {
      const archived = product({
        deleted_at: new Date('2026-07-10T09:00:00.000Z'),
      });
      const findAllPaginated = vi.fn(() =>
        Effect.succeed({
          data: [archived],
          meta: {
            page: 2,
            limit: 25,
            total: 26,
            total_pages: 2,
            has_next: false,
            has_previous: true,
          },
        }),
      );
      const test = makeHarness({
        products: { findAllPaginated },
        userPermissions: permissions(Permission.READ),
      });

      return Effect.gen(function* () {
        const callResult = yield* test.execute('products_list', {
          page: 2,
          limit: 25,
          search: '  green widget  ',
          category_id: CATEGORY_ID,
          primary_supplier_id: SUPPLIER_ID,
          is_active: true,
          is_perishable: false,
          min_price: 10,
          max_price: 50,
          include_archived: true,
          sort_by: ProductSortField.UPDATED_AT,
          sort_order: SortOrder.DESC,
        });
        const result = yield* decodeListResult(callResult);

        expect(test.getPermissionsForUser).toHaveBeenCalledWith(
          USER_ID,
          TENANT_ID,
        );
        expect(findAllPaginated).toHaveBeenCalledWith({
          page: 2,
          limit: 25,
          search: 'green widget',
          category_id: CATEGORY_ID,
          primary_supplier_id: SUPPLIER_ID,
          is_active: true,
          is_perishable: false,
          min_price: 10,
          max_price: 50,
          include_deleted: true,
          sort_by: ProductSortField.UPDATED_AT,
          sort_order: SortOrder.DESC,
        });
        expect(result).toMatchObject({
          pagination: {
            page: 2,
            limit: 25,
            total: 26,
            total_pages: 2,
          },
          products: [
            {
              id: PRODUCT_ID,
              category: { id: CATEGORY_ID, name: 'Widgets' },
              primary_supplier: {
                id: SUPPLIER_ID,
                name: 'Widget Supply',
              },
              archived_at: '2026-07-10T09:00:00.000Z',
              created_at: '2026-07-01T10:00:00.000Z',
              updated_at: '2026-07-02T11:00:00.000Z',
            },
          ],
        });
        expect(test.log).not.toHaveBeenCalled();
      });
    },
  );

  it.effect('gets an archived product and forwards include_archived', () => {
    const archived = product({
      deleted_at: new Date('2026-07-11T12:00:00.000Z'),
    });
    const findOne = vi.fn(() => Effect.succeed(archived));
    const test = makeHarness({
      products: { findOne },
      userPermissions: permissions(Permission.READ),
    });

    return Effect.gen(function* () {
      const callResult = yield* test.execute('products_get', {
        id: PRODUCT_ID,
        include_archived: true,
      });
      const result = yield* decodeGetResult(callResult);

      expect(test.getPermissionsForUser).toHaveBeenCalledWith(
        USER_ID,
        TENANT_ID,
      );
      expect(findOne).toHaveBeenCalledWith(PRODUCT_ID, true);
      expect(result.product).toMatchObject({
        id: PRODUCT_ID,
        name: 'Green Widget',
        archived_at: '2026-07-11T12:00:00.000Z',
      });
      expect(test.log).not.toHaveBeenCalled();
    });
  });

  it.effect(
    'blocks reads before calling ProductsService without READ permission',
    () => {
      const findOne = vi.fn(() => Effect.succeed(product()));
      const test = makeHarness({
        products: { findOne },
        userPermissions: permissions(Permission.WRITE),
      });

      return Effect.gen(function* () {
        const result = yield* test.execute('products_get', { id: PRODUCT_ID });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(
          'Insufficient permissions',
        );
        expect(findOne).not.toHaveBeenCalled();
        expect(test.log).not.toHaveBeenCalled();
      });
    },
  );

  it.effect(
    'creates a product, audits it, and returns an archive undo action',
    () => {
      const created = product({
        sku: 'NEW-201',
        name: 'New Widget',
        description: 'New stock item',
      });
      const create = vi.fn(() => Effect.succeed(created));
      const test = makeHarness({
        products: { create },
        userPermissions: permissions(Permission.WRITE),
      });

      return Effect.gen(function* () {
        const callResult = yield* test.execute('products_create', {
          sku: '  NEW-201  ',
          name: '  New Widget  ',
          description: '  New stock item  ',
          category_id: CATEGORY_ID,
          reorder_point: 5,
          is_active: true,
          is_perishable: false,
        });
        const result = yield* decodeMutationResult(callResult);

        expect(test.getPermissionsForUser).toHaveBeenCalledWith(
          USER_ID,
          TENANT_ID,
        );
        expect(create).toHaveBeenCalledWith(
          {
            sku: 'NEW-201',
            name: 'New Widget',
            description: 'New stock item',
            category_id: CATEGORY_ID,
            reorder_point: 5,
            is_active: true,
            is_perishable: false,
          },
          USER_ID,
        );
        expect(test.log).toHaveBeenCalledWith({
          action: AuditAction.CREATE,
          entityType: AuditEntityType.PRODUCT,
          entityId: PRODUCT_ID,
        });
        expect(result).toMatchObject({
          status: 'created',
          product: {
            id: PRODUCT_ID,
            name: 'New Widget',
            archived_at: null,
          },
          message: 'Created “New Widget”.',
          undo: {
            tool: 'products_archive',
            arguments: { id: PRODUCT_ID },
            label: 'Move “New Widget” to trash',
          },
        });
      });
    },
  );

  it.effect(
    'blocks creation before service and audit without WRITE permission',
    () => {
      const create = vi.fn(() => Effect.succeed(product()));
      const test = makeHarness({
        products: { create },
        userPermissions: permissions(Permission.READ),
      });

      return Effect.gen(function* () {
        const result = yield* test.execute('products_create', {
          sku: 'NEW-201',
          name: 'New Widget',
          category_id: CATEGORY_ID,
          reorder_point: 5,
          is_active: true,
          is_perishable: false,
        });

        expect(result.isError).toBe(true);
        expect(create).not.toHaveBeenCalled();
        expect(test.log).not.toHaveBeenCalled();
      });
    },
  );

  it.effect(
    'updates a product, audits it, and returns the previous values',
    () => {
      const before = product();
      const updated = product({
        name: 'Renamed Widget',
        standard_price: 24,
        updated_at: new Date('2026-07-15T14:00:00.000Z'),
      });
      const findOne = vi.fn(() => Effect.succeed(before));
      const update = vi.fn(() => Effect.succeed(updated));
      const test = makeHarness({
        products: { findOne, update },
        userPermissions: permissions(Permission.WRITE),
      });

      return Effect.gen(function* () {
        const callResult = yield* test.execute('products_update', {
          id: PRODUCT_ID,
          changes: {
            name: '  Renamed Widget  ',
            standard_price: 24,
          },
        });
        const result = yield* decodeMutationResult(callResult);

        expect(findOne).toHaveBeenCalledWith(PRODUCT_ID);
        expect(update).toHaveBeenCalledWith(
          PRODUCT_ID,
          { name: 'Renamed Widget', standard_price: 24 },
          USER_ID,
        );
        expect(test.log).toHaveBeenCalledWith({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.PRODUCT,
          entityId: PRODUCT_ID,
        });
        expect(result).toMatchObject({
          status: 'updated',
          product: {
            id: PRODUCT_ID,
            name: 'Renamed Widget',
            standard_price: 24,
          },
          undo: {
            tool: 'products_update',
            arguments: {
              id: PRODUCT_ID,
              changes: {
                sku: 'SKU-201',
                name: 'Green Widget',
                description: 'A useful widget',
                category_id: CATEGORY_ID,
                standard_cost: 10,
                standard_price: 20,
                primary_supplier_id: SUPPLIER_ID,
                is_active: true,
                is_perishable: false,
              },
            },
            label: 'Restore the previous values for “Green Widget”',
            limitation:
              'Best-effort only: use this before anyone makes another change to the product.',
          },
        });
      });
    },
  );

  it.effect(
    'restores a product, audits it, and returns an archive undo action',
    () => {
      const restored = product({ deleted_at: null });
      const restore = vi.fn(() => Effect.succeed(restored));
      const test = makeHarness({
        products: { restore },
        userPermissions: permissions(Permission.WRITE),
      });

      return Effect.gen(function* () {
        const callResult = yield* test.execute('products_restore', {
          id: PRODUCT_ID,
        });
        const result = yield* decodeMutationResult(callResult);

        expect(test.getPermissionsForUser).toHaveBeenCalledWith(
          USER_ID,
          TENANT_ID,
        );
        expect(restore).toHaveBeenCalledWith(PRODUCT_ID);
        expect(test.log).toHaveBeenCalledWith({
          action: AuditAction.RESTORE,
          entityType: AuditEntityType.PRODUCT,
          entityId: PRODUCT_ID,
        });
        expect(result).toMatchObject({
          status: 'restored',
          product: { id: PRODUCT_ID, archived_at: null },
          message: 'Restored “Green Widget”.',
          undo: {
            tool: 'products_archive',
            arguments: { id: PRODUCT_ID },
            label: 'Move “Green Widget” to trash',
          },
        });
      });
    },
  );
});
