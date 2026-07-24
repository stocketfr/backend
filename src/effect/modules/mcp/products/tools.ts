import { Tool } from '@effect/ai';
import { Schema } from 'effect';
import { Permission, Resource } from '@stocket/types/auth';
import {
  defineConfirmedMcpCommand,
  defineMcpCommand,
  defineMcpFeature,
  defineMcpQuery,
} from '../tool';
import {
  prepareProductArchive,
  productToolHandlers,
  rejectProductArchive,
} from './handlers';
import {
  CreateProductInputSchema,
  GetProductInputSchema,
  GetProductResultSchema,
  ListProductsInputSchema,
  ListProductsResultSchema,
  ProductIdInputSchema,
  ProductMutationResultSchema,
  UpdateProductInputSchema,
} from './schemas';

const productsReadAccess = {
  permissions: [{ resource: Resource.PRODUCTS, permission: Permission.READ }],
} as const;

const productsWriteAccess = {
  permissions: [{ resource: Resource.PRODUCTS, permission: Permission.WRITE }],
} as const;

const ProductsSearchTool = Tool.make('products_search', {
  description:
    'Search products in the current Stocket workspace. Returns concise summaries and stable product IDs for follow-up actions.',
  parameters: ListProductsInputSchema.fields,
  success: ListProductsResultSchema,
  failure: Schema.Unknown,
})
  .annotate(Tool.Title, 'Find products')
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ProductsSearch = defineMcpQuery({
  tool: ProductsSearchTool,
  access: productsReadAccess,
  policy: {
    kind: 'query',
    confirmation: 'never',
    effect: 'Only reads concise product summaries.',
  },
  run: productToolHandlers.products_search,
});

const GetProductTool = Tool.make('products_get', {
  description:
    'Get the current details for one product in the current Stocket workspace.',
  parameters: GetProductInputSchema.fields,
  success: GetProductResultSchema,
  failure: Schema.Unknown,
})
  .annotate(Tool.Title, 'View a product')
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const GetProduct = defineMcpQuery({
  tool: GetProductTool,
  access: productsReadAccess,
  policy: {
    kind: 'query',
    confirmation: 'never',
    effect: 'Only reads one product.',
  },
  run: productToolHandlers.products_get,
});

const CreateProductTool = Tool.make('products_create', {
  description:
    'Create one product in the current Stocket workspace. The result includes an action that can move the new product to trash.',
  parameters: CreateProductInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
})
  .annotate(Tool.Title, 'Add a product')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const CreateProduct = defineMcpCommand({
  tool: CreateProductTool,
  access: productsWriteAccess,
  policy: {
    kind: 'command',
    confirmation: 'never',
    effect: 'Adds one product.',
    reversible: 'yes',
    undoTool: 'products_archive',
  },
  run: productToolHandlers.products_create,
});

const UpdateProductTool = Tool.make('products_update', {
  description:
    'Change selected fields on one product. The result includes the previous values for an immediate best-effort undo.',
  parameters: UpdateProductInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
})
  .annotate(Tool.Title, 'Change a product')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const UpdateProduct = defineMcpCommand({
  tool: UpdateProductTool,
  access: productsWriteAccess,
  policy: {
    kind: 'command',
    confirmation: 'never',
    effect: 'Changes selected fields on one product.',
    reversible: 'best-effort',
    undoTool: 'products_update',
  },
  run: productToolHandlers.products_update,
});

const ArchiveProductTool = Tool.make('products_archive', {
  description:
    'Move one product to trash. This never permanently deletes it, requires a plain-language user confirmation, and can be undone with products_restore.',
  parameters: ProductIdInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
})
  .annotate(Tool.Title, 'Move a product to trash')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const ArchiveProduct = defineConfirmedMcpCommand({
  tool: ArchiveProductTool,
  access: productsWriteAccess,
  policy: {
    kind: 'command',
    confirmation: 'required',
    effect: 'Moves one product to trash; it is never permanently deleted.',
    reversible: 'yes',
    undoTool: 'products_restore',
  },
  prepare: prepareProductArchive,
  onRejected: rejectProductArchive,
  run: productToolHandlers.products_archive,
});

const RestoreProductTool = Tool.make('products_restore', {
  description:
    'Restore one product from trash to the current Stocket workspace.',
  parameters: ProductIdInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
})
  .annotate(Tool.Title, 'Restore a product')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

const RestoreProduct = defineMcpCommand({
  tool: RestoreProductTool,
  access: productsWriteAccess,
  policy: {
    kind: 'command',
    confirmation: 'never',
    effect: 'Restores one product from trash.',
    reversible: 'yes',
    undoTool: 'products_archive',
  },
  run: productToolHandlers.products_restore,
});

export const productMcpFeature = defineMcpFeature({
  domain: 'products',
  contractVersion: 1,
  registrations: [
    ProductsSearch,
    GetProduct,
    CreateProduct,
    UpdateProduct,
    ArchiveProduct,
    RestoreProduct,
  ],
});
