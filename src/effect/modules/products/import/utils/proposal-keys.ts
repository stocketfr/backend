const encodeDecisionSegment = (value: string) =>
  encodeURIComponent(value.trim());

const shortHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
};

export const categoryDecisionKey = (sourcePath: string) =>
  `category:${encodeDecisionSegment(sourcePath)}`;

export const locationDecisionKey = (sourceLocation: string) =>
  `location:${encodeDecisionSegment(sourceLocation)}`;

export const skuConflictDecisionKey = (sku: string) =>
  `sku-conflict:${encodeDecisionSegment(sku)}`;

export const skuVariantDecisionKey = (
  conflictKey: string,
  definitionKey: string,
) => `${conflictKey}:variant:${shortHash(definitionKey)}`;

export const MISSING_LOCATION_DECISION_KEY = 'missing-location';
