import type { MessageArgs } from '../../../platform/observability/messages';
import type { MessageKey } from '../../../platform/catalogs';

export const PRODUCT_IMPORT_PROGRESS_MESSAGES = {
  queued: 'products.importProgressQueued',
  starting: 'products.importProgressStarting',
  rowsProcessed: 'products.importProgressRowsProcessed',
  completed: 'products.importProgressCompleted',
} as const satisfies Record<string, MessageKey>;

export type ProductImportProgressMessageKey =
  (typeof PRODUCT_IMPORT_PROGRESS_MESSAGES)[keyof typeof PRODUCT_IMPORT_PROGRESS_MESSAGES];

const PRODUCT_IMPORT_PROGRESS_MESSAGE_KEYS = new Set<string>(
  Object.values(PRODUCT_IMPORT_PROGRESS_MESSAGES),
);

export const isProductImportProgressMessageKey = (
  value: string | null,
): value is ProductImportProgressMessageKey =>
  value !== null && PRODUCT_IMPORT_PROGRESS_MESSAGE_KEYS.has(value);

export const productImportProgressMessageArgs = (
  messageKey: ProductImportProgressMessageKey,
  counts: { readonly processed: number; readonly total: number | null },
): MessageArgs | undefined =>
  messageKey === PRODUCT_IMPORT_PROGRESS_MESSAGES.rowsProcessed
    ? {
        processedRows: counts.processed,
        totalRows: counts.total ?? 0,
      }
    : undefined;
