import { Schema } from 'effect';
import {
  ProductImportPlanSchema,
  ProductImportTypes,
  type ProductImportPlan,
  type ProductImportType,
} from '../types';
import { productImportBlobPrefix } from './utils';

export const PRODUCT_IMPORT_TASK_TYPE = 'product-import';

export interface EnqueueProductImportOptions {
  readonly bytes: Uint8Array;
  readonly importType: ProductImportType;
  readonly approvedPlan?: ProductImportPlan;
  readonly idempotencyKey?: string;
  readonly userId: string;
}

const ProductImportTypeSchema = Schema.Literal(...ProductImportTypes);

const productImportBlobKeySchema = (tenantId: string) =>
  Schema.String.pipe(
    Schema.filter((key) => key.startsWith(productImportBlobPrefix(tenantId))),
  );

export const productImportTaskPayloadSchema = (tenantId: string) =>
  Schema.Struct({
    blobKey: productImportBlobKeySchema(tenantId),
    importType: ProductImportTypeSchema,
    approvedPlan: Schema.optional(ProductImportPlanSchema),
  });

export const productImportBlobReferenceSchema = (tenantId: string) =>
  Schema.Struct({ blobKey: productImportBlobKeySchema(tenantId) });
