export interface ProductImportLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface ImportProductsOptions {
  tenantId: string;
  userId?: string;
  logger?: ProductImportLogger;
}

export interface ProductImportRow {
  sku: string;
  name: string;
  categoryPath: string;
  reorderPoint: number;
  quantity: number;
  locationName: string;
  unit: string | null;
  standardPrice: number | null;
  barcode: string | null;
  description: string | null;
  notes: string | null;
  isActive: boolean;
  isPerishable: boolean;
  expiryDate: Date | null;
}
