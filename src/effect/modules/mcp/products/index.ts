import {
  implementConfirmedMcpTool,
  implementMcpTool,
  makeMcpOutputCodec,
  makeMcpToolRegistry,
} from '../tool';
import type { McpToolSafetyWithoutConfirmation } from '../types';
import {
  prepareProductArchive,
  productToolHandlers,
  rejectProductArchive,
} from './handlers';
import {
  ArchiveProductTool,
  CreateProductTool,
  GetProductTool,
  ListProductsTool,
  RestoreProductTool,
  UpdateProductTool,
} from './toolkit';

const readSafety = (effect: string): McpToolSafetyWithoutConfirmation => ({
  confirmation: 'never',
  effect,
  reversible: 'yes',
});

export const productMcpRegistrations = [
  implementMcpTool(
    ListProductsTool,
    readSafety('Only reads product information.'),
    makeMcpOutputCodec(ListProductsTool.successSchema),
    productToolHandlers.products_list,
  ),
  implementMcpTool(
    GetProductTool,
    readSafety('Only reads one product.'),
    makeMcpOutputCodec(GetProductTool.successSchema),
    productToolHandlers.products_get,
  ),
  implementMcpTool(
    CreateProductTool,
    {
      confirmation: 'never',
      effect: 'Adds one product.',
      reversible: 'yes',
      undoTool: 'products_archive',
    },
    makeMcpOutputCodec(CreateProductTool.successSchema),
    productToolHandlers.products_create,
  ),
  implementMcpTool(
    UpdateProductTool,
    {
      confirmation: 'never',
      effect: 'Changes selected fields on one product.',
      reversible: 'best-effort',
      undoTool: 'products_update',
    },
    makeMcpOutputCodec(UpdateProductTool.successSchema),
    productToolHandlers.products_update,
  ),
  implementConfirmedMcpTool(
    ArchiveProductTool,
    {
      confirmation: 'required',
      effect: 'Moves one product to trash; it is never permanently deleted.',
      reversible: 'yes',
      undoTool: 'products_restore',
    },
    makeMcpOutputCodec(ArchiveProductTool.successSchema),
    prepareProductArchive,
    rejectProductArchive,
    productToolHandlers.products_archive,
  ),
  implementMcpTool(
    RestoreProductTool,
    {
      confirmation: 'never',
      effect: 'Restores one product from trash.',
      reversible: 'yes',
      undoTool: 'products_archive',
    },
    makeMcpOutputCodec(RestoreProductTool.successSchema),
    productToolHandlers.products_restore,
  ),
] as const;

export const productMcpRegistry = makeMcpToolRegistry(productMcpRegistrations);
