export const productImportBlobPrefix = (tenantId: string): string =>
  `background-tasks/product-import/${tenantId}/`;

export const productImportBlobKey = (
  tenantId: string,
  objectId: string,
): string => `${productImportBlobPrefix(tenantId)}${objectId}.csv`;
