import { Effect } from 'effect';
import { pgUniqueViolationConstraintName } from '../../platform/db/pg-errors';
import type { TenantNotResolved } from '../../platform/tenancy/tenant-context';
import {
  PriceBelowCost,
  SkuAlreadyExists,
  type ProductsInfrastructureError,
} from './products.errors';

export const PRODUCT_SKU_UNIQUE_CONSTRAINT = 'products_tenant_sku_unique';

export interface ProductSkuLookup {
  readonly findBySku: (
    sku: string,
    includeDeleted: boolean,
  ) => Effect.Effect<
    unknown | null,
    ProductsInfrastructureError | TenantNotResolved
  >;
}

export const skuAlreadyExists = (sku: string) =>
  new SkuAlreadyExists({
    sku,
    messageKey: 'products.skuAlreadyExists',
  });

export const ensureSkuAvailable = (
  repository: ProductSkuLookup,
  sku: string,
): Effect.Effect<
  void,
  ProductsInfrastructureError | SkuAlreadyExists | TenantNotResolved
> =>
  repository.findBySku(sku, true).pipe(
    Effect.filterOrFail(
      (existing) => existing === null,
      () => skuAlreadyExists(sku),
    ),
    Effect.asVoid,
  );

export const mapSkuUniqueViolation =
  <E>(sku: string) =>
  (error: E): E | SkuAlreadyExists =>
    pgUniqueViolationConstraintName(error) === PRODUCT_SKU_UNIQUE_CONSTRAINT
      ? skuAlreadyExists(sku)
      : error;

export const validatePriceNotBelowCost = (
  standardPrice: number | null | undefined,
  standardCost: number | null | undefined,
): Effect.Effect<void, PriceBelowCost> => {
  if (
    standardPrice != null &&
    standardCost != null &&
    standardPrice < standardCost
  ) {
    return Effect.fail(
      new PriceBelowCost({
        standardPrice,
        standardCost,
        messageKey: 'products.priceBelowCost',
      }),
    );
  }
  return Effect.void;
};
