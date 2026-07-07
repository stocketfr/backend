import type { ImportCaches, ImportProductRow, ImportRunState } from './types';
import { makeEmptyProductImportResult } from './utils';

export const makeImportCaches = (): ImportCaches => ({
  categories: new Map<string, string>(),
  locations: new Map<string, string>(),
  areas: new Map<string, string>(),
  products: new Map<string, ImportProductRow>(),
  photoUrlsByProduct: new Map<string, Set<string>>(),
});

export const makeImportRunState = (): ImportRunState => ({
  caches: makeImportCaches(),
  result: makeEmptyProductImportResult(),
});
