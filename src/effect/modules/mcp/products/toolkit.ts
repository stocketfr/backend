import { Tool, Toolkit } from '@effect/ai';
import { HttpServerRequest } from '@effect/platform';
import { Schema } from 'effect';
import { AuditLogWriter } from '../../../platform/audit';
import { BetterAuth } from '../../../platform/auth/better-auth';
import { PermissionProvider } from '../../../platform/auth/permission-provider';
import { CurrentRequestActor } from '../../../platform/auth/request-actor';
import { ProductsService } from '../../products/service';
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

const productReadDependencies = [
  PermissionProvider,
  CurrentRequestActor,
  ProductsService,
];

const productMutationDependencies = [
  ...productReadDependencies,
  AuditLogWriter,
  BetterAuth,
  HttpServerRequest.HttpServerRequest,
];

export const ListProductsTool = Tool.make('products_list', {
  description:
    'List and search products in the current Stocket workspace. Use the returned product IDs for later actions.',
  parameters: ListProductsInputSchema.fields,
  success: ListProductsResultSchema,
  failure: Schema.Unknown,
  dependencies: productReadDependencies,
})
  .annotate(Tool.Title, 'Find products')
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const GetProductTool = Tool.make('products_get', {
  description:
    'Get the current details for one product in the current Stocket workspace.',
  parameters: GetProductInputSchema.fields,
  success: GetProductResultSchema,
  failure: Schema.Unknown,
  dependencies: productReadDependencies,
})
  .annotate(Tool.Title, 'View a product')
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const CreateProductTool = Tool.make('products_create', {
  description:
    'Create one product in the current Stocket workspace. The result includes an action that can move the new product to trash.',
  parameters: CreateProductInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
  dependencies: productMutationDependencies,
})
  .annotate(Tool.Title, 'Add a product')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const UpdateProductTool = Tool.make('products_update', {
  description:
    'Change selected fields on one product. The result includes the previous values for an immediate best-effort undo.',
  parameters: UpdateProductInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
  dependencies: productMutationDependencies,
})
  .annotate(Tool.Title, 'Change a product')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ArchiveProductTool = Tool.make('products_archive', {
  description:
    'Move one product to trash. This never permanently deletes it, requires a plain-language user confirmation, and can be undone with products_restore.',
  parameters: ProductIdInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
  dependencies: productMutationDependencies,
})
  .annotate(Tool.Title, 'Move a product to trash')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const RestoreProductTool = Tool.make('products_restore', {
  description:
    'Restore one product from trash to the current Stocket workspace.',
  parameters: ProductIdInputSchema.fields,
  success: ProductMutationResultSchema,
  failure: Schema.Unknown,
  dependencies: productMutationDependencies,
})
  .annotate(Tool.Title, 'Restore a product')
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const ProductsToolkit = Toolkit.make(
  ListProductsTool,
  GetProductTool,
  CreateProductTool,
  UpdateProductTool,
  ArchiveProductTool,
  RestoreProductTool,
);
