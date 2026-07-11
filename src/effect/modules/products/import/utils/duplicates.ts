import type {
  NormalizedProductImportRow,
  ProductImportDuplicateSkuConflictDto,
} from '../types';
import { normalizeCategoryPath } from './csv';
import {
  nullableText,
  parseBoolean,
  parseDate,
  parseInteger,
  parseProductImportNumber,
} from './value-parsers';
import { skuConflictDecisionKey, skuVariantDecisionKey } from './proposal-keys';

export function productDefinitionKey(
  row: NormalizedProductImportRow,
  options: { readonly includeReorderPoint: boolean },
): string {
  const expiryDate = parseDate(row.expiry_date);
  return JSON.stringify({
    name: row.name.trim(),
    category_path: normalizeCategoryPath(row.category_path),
    unit: nullableText(row.unit) ?? '',
    standard_price: parseProductImportNumber(row.standard_price),
    ...(options.includeReorderPoint
      ? { reorder_point: parseInteger(row.reorder_point, 0) }
      : {}),
    barcode: nullableText(row.barcode) ?? '',
    description: nullableText(row.description) ?? '',
    notes: nullableText(row.notes) ?? '',
    is_active: parseBoolean(row.is_active, true),
    is_perishable: parseBoolean(row.is_perishable, Boolean(expiryDate)),
  });
}

const MAX_DERIVED_SKU_LENGTH = 50;

const sanitizeSkuSegment = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const shortHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6);
};

const fitDerivedSku = (
  sourceSku: string,
  name: string,
  definitionKey: string,
  existingSkus: ReadonlySet<string>,
): string => {
  const sourceSegment = sanitizeSkuSegment(sourceSku) || 'SKU';
  const nameSegment = sanitizeSkuSegment(name) || 'ITEM';
  const readable = `${sourceSegment}-${nameSegment}`;
  if (
    readable.length <= MAX_DERIVED_SKU_LENGTH &&
    !existingSkus.has(readable)
  ) {
    return readable;
  }

  const hashSuffix = `-${shortHash(definitionKey)}`;
  const prefixLength = MAX_DERIVED_SKU_LENGTH - hashSuffix.length;
  const prefix = readable
    .slice(0, Math.max(1, prefixLength))
    .replace(/-+$/g, '');
  return `${prefix}${hashSuffix}`;
};

export function deriveConflictingDuplicateSkuRows(
  rows: readonly NormalizedProductImportRow[],
  options: { readonly includeReorderPoint?: boolean } = {},
): Map<number, string> {
  const keyOptions = {
    includeReorderPoint: options.includeReorderPoint ?? false,
  };
  const rowsBySku = new Map<string, NormalizedProductImportRow[]>();
  const nonEmptySkus = new Set<string>();

  for (const row of rows) {
    if (!row.sku || !row.name) continue;
    nonEmptySkus.add(row.sku);
    const existing = rowsBySku.get(row.sku) ?? [];
    existing.push(row);
    rowsBySku.set(row.sku, existing);
  }

  const derivedSkusByRow = new Map<number, string>();
  for (const [sku, skuRows] of rowsBySku.entries()) {
    const rowsByDefinition = new Map<
      string,
      readonly NormalizedProductImportRow[]
    >();
    for (const row of skuRows) {
      const definitionKey = productDefinitionKey(row, keyOptions);
      rowsByDefinition.set(definitionKey, [
        ...(rowsByDefinition.get(definitionKey) ?? []),
        row,
      ]);
    }

    if (skuRows.length <= 1 || rowsByDefinition.size <= 1) continue;

    const reservedSkus = new Set(nonEmptySkus);
    reservedSkus.delete(sku);

    for (const [definitionKey, definitionRows] of rowsByDefinition.entries()) {
      const representative = definitionRows[0];
      if (!representative) continue;

      let derivedSku = fitDerivedSku(
        sku,
        representative.name,
        definitionKey,
        reservedSkus,
      );
      let collisionIndex = 1;
      while (reservedSkus.has(derivedSku)) {
        derivedSku = fitDerivedSku(
          sku,
          `${representative.name}-${collisionIndex}`,
          `${definitionKey}:${collisionIndex}`,
          reservedSkus,
        );
        collisionIndex++;
      }
      reservedSkus.add(derivedSku);

      for (const row of definitionRows) {
        derivedSkusByRow.set(row.sourceRow, derivedSku);
      }
    }
  }

  return derivedSkusByRow;
}

export function findConflictingDuplicateSkuRows(
  rows: readonly NormalizedProductImportRow[],
  options: { readonly includeReorderPoint?: boolean } = {},
): Set<number> {
  const conflicts = new Set<number>();
  for (const group of findConflictingDuplicateSkuGroups(rows, options)) {
    group.rows.forEach((row) => conflicts.add(row));
  }
  return conflicts;
}

export function findConflictingDuplicateSkuGroups(
  rows: readonly NormalizedProductImportRow[],
  options: { readonly includeReorderPoint?: boolean } = {},
): ProductImportDuplicateSkuConflictDto[] {
  interface DefinitionEntry {
    readonly rows: number[];
    readonly names: Set<string>;
  }
  interface SkuEntry {
    readonly rows: number[];
    readonly definitions: Map<string, DefinitionEntry>;
    readonly names: Set<string>;
  }
  const makeDefinitionEntry = (): DefinitionEntry => ({
    rows: [],
    names: new Set<string>(),
  });
  const makeSkuEntry = (): SkuEntry => ({
    rows: [],
    definitions: new Map<string, DefinitionEntry>(),
    names: new Set<string>(),
  });
  const keyOptions = {
    includeReorderPoint: options.includeReorderPoint ?? false,
  };
  const definitionsBySku = new Map<string, SkuEntry>();

  for (const row of rows) {
    if (!row.sku || !row.name) continue;

    const entry = definitionsBySku.get(row.sku) ?? makeSkuEntry();
    entry.rows.push(row.sourceRow);
    const definitionKey = productDefinitionKey(row, keyOptions);
    const definition =
      entry.definitions.get(definitionKey) ?? makeDefinitionEntry();
    definition.rows.push(row.sourceRow);
    definition.names.add(row.name.trim());
    entry.definitions.set(definitionKey, definition);
    entry.names.add(row.name.trim());
    definitionsBySku.set(row.sku, entry);
  }

  const conflicts: ProductImportDuplicateSkuConflictDto[] = [];
  for (const [sku, entry] of definitionsBySku.entries()) {
    if (entry.rows.length > 1 && entry.definitions.size > 1) {
      const conflictKey = skuConflictDecisionKey(sku);
      conflicts.push({
        conflictKey,
        sku,
        rows: [...entry.rows],
        names: [...entry.names].sort((left, right) =>
          left.localeCompare(right),
        ),
        variants: [...entry.definitions.entries()]
          .map(([definitionKey, definition]) => ({
            variantKey: skuVariantDecisionKey(conflictKey, definitionKey),
            rows: [...definition.rows].sort((left, right) => left - right),
            names: [...definition.names].sort((left, right) =>
              left.localeCompare(right),
            ),
          }))
          .sort(
            (left, right) =>
              (left.rows[0] ?? 0) - (right.rows[0] ?? 0) ||
              left.variantKey.localeCompare(right.variantKey),
          ),
      });
    }
  }
  return conflicts.sort((left, right) => left.sku.localeCompare(right.sku));
}
