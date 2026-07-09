import type { ImportCaches, ImportProductRow } from './types';
import { makeEmptyProductImportResult } from './utils/result';

export const makeImportCaches = (): ImportCaches => ({
  categories: new Map<string, string>(),
  locations: new Map<string, string>(),
  areas: new Map<string, string>(),
  products: new Map<string, ImportProductRow>(),
  photoUrlsByProduct: new Map<string, Set<string>>(),
});

export const makeImportRunState = () => ({
  caches: makeImportCaches(),
  result: makeEmptyProductImportResult(),
});
