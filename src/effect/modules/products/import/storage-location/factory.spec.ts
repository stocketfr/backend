import { describe, expect, it } from 'vitest';
import {
  createStorageLocationParser,
  suggestLocationMapping,
} from './factory';

describe('storage location parser factory', () => {
  it('creates parsers for every product import format', () => {
    expect(createStorageLocationParser('sortly-items').source).toBe(
      'sortly-items',
    );
    expect(createStorageLocationParser('normalized-products').source).toBe(
      'normalized-products',
    );
  });

  it('reuses parser instances per product import format', () => {
    expect(createStorageLocationParser('sortly-items')).toBe(
      createStorageLocationParser('sortly-items'),
    );
    expect(createStorageLocationParser('normalized-products')).toBe(
      createStorageLocationParser('normalized-products'),
    );
  });

  it('parses Sortly bay, shelf, and bin values as nested areas', () => {
    expect(
      suggestLocationMapping('Bay I - Shelf 3 - Bin A', 'sortly-items'),
    ).toEqual({
      sourceLocation: 'Bay I - Shelf 3 - Bin A',
      areaPath: 'Bay I / Shelf 3 / Bin A',
      action: 'create-area',
      confidence: 0.9,
    });
  });

  it('parses Sortly slash-separated storage values as nested areas', () => {
    expect(suggestLocationMapping('Bay I / Shelf 3', 'sortly-items')).toEqual({
      sourceLocation: 'Bay I / Shelf 3',
      areaPath: 'Bay I / Shelf 3',
      action: 'create-area',
      confidence: 0.9,
    });
  });

  it('parses Sortly room, rack, and bin values as nested areas', () => {
    expect(
      suggestLocationMapping('Room 2 - Rack B - Bin 4', 'sortly-items'),
    ).toEqual({
      sourceLocation: 'Room 2 - Rack B - Bin 4',
      areaPath: 'Room 2 / Rack B / Bin 4',
      action: 'create-area',
      confidence: 0.9,
    });
  });

  it('parses compact Sortly labeled storage values as nested areas', () => {
    expect(suggestLocationMapping('Bay I Shelf 3', 'sortly-items')).toEqual({
      sourceLocation: 'Bay I Shelf 3',
      areaPath: 'Bay I / Shelf 3',
      action: 'create-area',
      confidence: 0.9,
    });
  });

  it('keeps unrecognized Sortly storage values as locations', () => {
    expect(suggestLocationMapping('Spa Store Room', 'sortly-items')).toEqual({
      sourceLocation: 'Spa Store Room',
      targetLocationName: 'Spa Store Room',
      action: 'create-location',
      confidence: 0.65,
    });
  });

  it('keeps normalized product storage values as locations', () => {
    expect(
      suggestLocationMapping('Bay I - Shelf 3', 'normalized-products'),
    ).toEqual({
      sourceLocation: 'Bay I - Shelf 3',
      targetLocationName: 'Bay I - Shelf 3',
      action: 'create-location',
      confidence: 0.65,
    });
  });
});
