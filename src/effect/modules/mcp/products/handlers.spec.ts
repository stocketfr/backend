import { HttpServerRequest } from '@effect/platform';
import { describe, expect, it, vi } from '@effect/vitest';
import { Effect, Layer, Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import type { ProductResponseDto } from '@stocket/types/products';
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
import { McpInvocation, type McpConfirmationDecision } from '../types';
import { productMcpRegistry } from './index';
import { ProductMutationResultSchema } from './schemas';

const PRODUCT_ID = '00000000-0000-4000-8000-000000000101';
const CATEGORY_ID = '00000000-0000-4000-8000-000000000102';
const USER_ID = '00000000-0000-4000-8000-000000000103';
const TENANT_ID = '00000000-0000-4000-8000-000000000104';

const product = (
  overrides: Partial<ProductResponseDto> = {},
): ProductResponseDto => ({
  id: PRODUCT_ID,
  sku: 'SKU-101',
  name: 'Blue Widget',
  description: null,
  category_id: CATEGORY_ID,
  category: null,
  volume_ml: null,
  weight_kg: null,
  dimensions_cm: null,
  standard_cost: 10,
  standard_price: 20,
  markup_percentage: 100,
  reorder_point: 5,
  primary_supplier_id: null,
  primary_supplier: null,
  supplier_sku: null,
  barcode: null,
  unit: 'piece',
  is_active: true,
  is_perishable: false,
  notes: null,
  created_at: new Date('2026-07-01T10:00:00.000Z'),
  updated_at: new Date('2026-07-01T10:00:00.000Z'),
  deleted_at: null,
  ...overrides,
});

const actor: RequestActor = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  tenantName: 'Test workspace',
  tenantSlug: 'test-workspace',
};

const permissions = (canWrite: boolean): UserPermissions => ({
  roleNames: ['test-role'],
  permissions: {
    [Resource.PRODUCTS]: canWrite
      ? [Permission.READ, Permission.WRITE]
      : [Permission.READ],
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

interface ArchiveTestOptions {
  readonly canWrite?: boolean;
  readonly revokeAfterConfirmation?: boolean;
  readonly changeAfterConfirmation?: boolean;
}

const runArchive = (
  decision: McpConfirmationDecision,
  options: ArchiveTestOptions = {},
) => {
  const canWrite = options.canWrite ?? true;
  const current = product();
  const afterConfirmation = product({
    updated_at: options.changeAfterConfirmation
      ? new Date('2026-07-15T11:30:00.000Z')
      : current.updated_at,
  });
  const archived = product({
    deleted_at: new Date('2026-07-15T12:00:00.000Z'),
  });
  const findOne = vi
    .fn()
    .mockReturnValueOnce(Effect.succeed(current))
    .mockReturnValueOnce(Effect.succeed(afterConfirmation))
    .mockReturnValueOnce(Effect.succeed(archived));
  const remove = vi.fn(() => Effect.void);
  const requestConfirmation = vi.fn(() => Effect.succeed(decision));
  const getPermissionsForUser = vi.fn(() =>
    Effect.succeed(permissions(canWrite)),
  );
  if (options.revokeAfterConfirmation) {
    getPermissionsForUser
      .mockReturnValueOnce(Effect.succeed(permissions(true)))
      .mockReturnValue(Effect.succeed(permissions(false)));
  }
  const log = vi.fn(() => Effect.void);

  const layer = Layer.mergeAll(
    makeTestLayer(ProductsService)({ findOne, delete: remove }),
    makeTestLayer(PermissionProvider)({ getPermissionsForUser }),
    makeTestLayer(AuditLogWriter)({ log }),
    Layer.succeed(CurrentRequestActor, actor),
    Layer.succeed(CurrentRequestContext, {
      requestId: '00000000-0000-4000-8000-000000000105',
      path: '/api/v1/mcp',
      method: 'POST',
      ip: null,
      locale: 'en',
      tenantId: TENANT_ID,
      tenantName: actor.tenantName,
      tenantSlug: actor.tenantSlug,
    }),
    Layer.succeed(McpInvocation, { requestConfirmation }),
    makeBetterAuthTestLayer(),
    requestLayer,
  );

  const effect = productMcpRegistry
    .execute('products_archive', { id: PRODUCT_ID })
    .pipe(Effect.provide(layer));

  return {
    effect,
    findOne,
    remove,
    requestConfirmation,
    getPermissionsForUser,
    log,
  };
};

const decodeMutationResult = (result: {
  readonly structuredContent?: Record<string, unknown>;
}) =>
  Schema.decodeUnknown(ProductMutationResultSchema)(result.structuredContent);

describe('MCP product archive handler', () => {
  it.effect('leaves the product unchanged when the user declines', () => {
    const test = runArchive('declined');

    return Effect.gen(function* () {
      const callResult = yield* test.effect;
      const result = yield* decodeMutationResult(callResult);

      expect(result.status).toBe('cancelled');
      expect(result.message).toBe('Nothing was changed.');
      expect(test.remove).not.toHaveBeenCalled();
      expect(test.log).not.toHaveBeenCalled();
      expect(test.findOne).toHaveBeenCalledTimes(1);
    });
  });

  it.effect('fails closed when the MCP client cannot show confirmation', () => {
    const test = runArchive('unavailable');

    return Effect.gen(function* () {
      const callResult = yield* test.effect;
      const result = yield* decodeMutationResult(callResult);

      expect(result.status).toBe('confirmation_required');
      expect(test.remove).not.toHaveBeenCalled();
      expect(test.log).not.toHaveBeenCalled();
    });
  });

  it.effect(
    'soft-deletes only after confirmation and returns a restore action',
    () => {
      const test = runArchive('accepted');

      return Effect.gen(function* () {
        const callResult = yield* test.effect;
        const result = yield* decodeMutationResult(callResult);

        expect(test.remove).toHaveBeenCalledWith(PRODUCT_ID, USER_ID, false);
        expect(test.log).toHaveBeenCalledWith({
          action: AuditAction.DELETE,
          entityType: AuditEntityType.PRODUCT,
          entityId: PRODUCT_ID,
        });
        expect(test.findOne).toHaveBeenLastCalledWith(PRODUCT_ID, true);
        expect(result).toMatchObject({
          status: 'archived',
          undo: {
            tool: 'products_restore',
            arguments: { id: PRODUCT_ID },
          },
        });
      });
    },
  );

  it.effect(
    'checks the actor permission before reading or changing a product',
    () => {
      const test = runArchive('accepted', { canWrite: false });

      return Effect.gen(function* () {
        const result = yield* test.effect;

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(
          'Insufficient permissions',
        );
        expect(test.getPermissionsForUser).toHaveBeenCalledWith(
          USER_ID,
          TENANT_ID,
        );
        expect(test.findOne).not.toHaveBeenCalled();
        expect(test.requestConfirmation).not.toHaveBeenCalled();
        expect(test.remove).not.toHaveBeenCalled();
      });
    },
  );

  it.effect(
    'rechecks permission after confirmation before changing data',
    () => {
      const test = runArchive('accepted', {
        revokeAfterConfirmation: true,
      });

      return Effect.gen(function* () {
        const result = yield* test.effect;

        expect(result.isError).toBe(true);
        expect(test.requestConfirmation).toHaveBeenCalledOnce();
        expect(test.getPermissionsForUser).toHaveBeenCalledTimes(2);
        expect(test.remove).not.toHaveBeenCalled();
        expect(test.log).not.toHaveBeenCalled();
      });
    },
  );

  it.effect('rejects a product that changed after it was confirmed', () => {
    const test = runArchive('accepted', {
      changeAfterConfirmation: true,
    });

    return Effect.gen(function* () {
      const result = yield* test.effect;

      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        'changed while confirmation was open',
      );
      expect(test.remove).not.toHaveBeenCalled();
      expect(test.log).not.toHaveBeenCalled();
    });
  });
});
