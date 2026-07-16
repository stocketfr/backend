import { Effect } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import { AuditAction, AuditEntityType } from '@stocket/types/audit-logs';
import { auditMutation } from '../../../platform/audited-mutation';
import { requireRequestActorPermission } from '../../../platform/auth/authorization';
import { CurrentRequestActor } from '../../../platform/auth/request-actor';
import { ProductsService } from '../../products/service';
import { McpConfirmationConflict } from '../mcp.errors';
import {
  toMcpProduct,
  toMcpProductsPage,
  toProductQuery,
  toUpdateProductDto,
} from './mappers';
import type {
  CreateProductInput,
  GetProductInput,
  ListProductsInput,
  McpProduct,
  ProductIdInput,
  ProductMutationResult,
  UpdateProductInput,
} from './schemas';

const requireProductsRead = requireRequestActorPermission(
  Resource.PRODUCTS,
  Permission.READ,
);

const requireProductsWrite = requireRequestActorPermission(
  Resource.PRODUCTS,
  Permission.WRITE,
);

const archiveUndo = (id: string, name: string) => ({
  tool: 'products_archive' as const,
  arguments: { id },
  label: `Move “${name}” to trash`,
  limitation:
    'This removes the product from normal lists but keeps it available to restore.',
});

const restoreUndo = (id: string, name: string) => ({
  tool: 'products_restore' as const,
  arguments: { id },
  label: `Restore “${name}”`,
  limitation: 'This restores the product from trash.',
});

interface ProductArchiveState {
  readonly product: McpProduct;
}

export const prepareProductArchive = ({ id }: ProductIdInput) =>
  Effect.gen(function* () {
    yield* requireProductsWrite;
    const products = yield* ProductsService;
    const product = toMcpProduct(yield* products.findOne(id));

    return {
      request: {
        message: `Move “${product.name}” (${product.sku}) to trash? It will disappear from normal product lists, but you can restore it later.`,
        confirmLabel: 'Move to trash',
      },
      state: { product },
    };
  });

export const rejectProductArchive = (
  _input: ProductIdInput,
  state: ProductArchiveState,
  decision: 'declined' | 'unavailable',
): ProductMutationResult => ({
  status: decision === 'declined' ? 'cancelled' : 'confirmation_required',
  product: state.product,
  message:
    decision === 'declined'
      ? 'Nothing was changed.'
      : 'Nothing was changed because the MCP client could not show the required confirmation.',
});

export const productToolHandlers = {
  products_list: (input: ListProductsInput) =>
    Effect.gen(function* () {
      yield* requireProductsRead;
      const products = yield* ProductsService;
      const page = yield* products.findAllPaginated(toProductQuery(input));
      return toMcpProductsPage(page);
    }),

  products_get: ({ id, include_archived }: GetProductInput) =>
    Effect.gen(function* () {
      yield* requireProductsRead;
      const products = yield* ProductsService;
      const product = yield* products.findOne(id, include_archived);
      return { product: toMcpProduct(product) };
    }),

  products_create: (input: CreateProductInput) =>
    Effect.gen(function* () {
      yield* requireProductsWrite;
      const actor = yield* CurrentRequestActor;
      const products = yield* ProductsService;
      const product = yield* auditMutation(
        products.create(input, actor.userId),
        {
          action: AuditAction.CREATE,
          entityType: AuditEntityType.PRODUCT,
          entityId: (created) => created.id,
        },
      );

      return {
        status: 'created',
        product: toMcpProduct(product),
        message: `Created “${product.name}”.`,
        undo: archiveUndo(product.id, product.name),
      } satisfies ProductMutationResult;
    }),

  products_update: ({ id, changes }: UpdateProductInput) =>
    Effect.gen(function* () {
      yield* requireProductsWrite;
      const actor = yield* CurrentRequestActor;
      const products = yield* ProductsService;
      const before = yield* products.findOne(id);
      const product = yield* auditMutation(
        products.update(id, changes, actor.userId),
        {
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.PRODUCT,
          entityId: id,
        },
      );

      return {
        status: 'updated',
        product: toMcpProduct(product),
        message: `Updated “${product.name}”.`,
        undo: {
          tool: 'products_update',
          arguments: { id, changes: toUpdateProductDto(before) },
          label: `Restore the previous values for “${before.name}”`,
          limitation:
            'Best-effort only: use this before anyone makes another change to the product.',
        },
      } satisfies ProductMutationResult;
    }),

  products_archive: ({ id }: ProductIdInput, state: ProductArchiveState) =>
    Effect.gen(function* () {
      // Confirmation can remain open for an arbitrary amount of time. Apply
      // permission changes and reject a stale preview immediately before the
      // write rather than treating the original check as an authorization lease.
      yield* requireProductsWrite;
      const actor = yield* CurrentRequestActor;
      const products = yield* ProductsService;
      const current = yield* products.findOne(id);
      if (toMcpProduct(current).updated_at !== state.product.updated_at) {
        return yield* Effect.fail(
          new McpConfirmationConflict({
            resourceId: id,
            messageKey: 'mcp.changedSinceConfirmation',
          }),
        );
      }

      yield* auditMutation(products.delete(id, actor.userId, false), {
        action: AuditAction.DELETE,
        entityType: AuditEntityType.PRODUCT,
        entityId: id,
      });
      const archived = yield* products.findOne(id, true);

      return {
        status: 'archived',
        product: toMcpProduct(archived),
        message: `Moved “${archived.name}” to trash.`,
        undo: restoreUndo(archived.id, archived.name),
      } satisfies ProductMutationResult;
    }),

  products_restore: ({ id }: ProductIdInput) =>
    Effect.gen(function* () {
      yield* requireProductsWrite;
      const products = yield* ProductsService;
      const product = yield* auditMutation(products.restore(id), {
        action: AuditAction.RESTORE,
        entityType: AuditEntityType.PRODUCT,
        entityId: id,
      });

      return {
        status: 'restored',
        product: toMcpProduct(product),
        message: `Restored “${product.name}”.`,
        undo: archiveUndo(product.id, product.name),
      } satisfies ProductMutationResult;
    }),
};
