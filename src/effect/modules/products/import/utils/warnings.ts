import type { ProductImportWarningDto } from '../types';

export const makeImportWarning = (
  message: string,
  options: {
    readonly row?: number;
    readonly field?: string;
    readonly severity?: ProductImportWarningDto['severity'];
  } = {},
): ProductImportWarningDto => ({
  severity: options.severity ?? 'warning',
  message,
  ...(options.row === undefined ? {} : { row: options.row }),
  ...(options.field === undefined ? {} : { field: options.field }),
});
