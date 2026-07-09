import { describe, expect, it } from 'vitest';
import { hasDefinedPatchValues, pickDefined } from '../effect/pick-defined';

interface PatchTarget {
  readonly name: string;
  readonly quantity: number;
  readonly nullable: string | null;
  readonly enabled: boolean;
}

describe('pickDefined', () => {
  it('keeps defined falsey values and drops undefined values', () => {
    const patch = pickDefined<PatchTarget>([
      ['name', undefined],
      ['quantity', 0],
      ['nullable', null],
      ['enabled', false],
    ]);

    expect(patch).toEqual({
      quantity: 0,
      nullable: null,
      enabled: false,
    });
    expect(hasDefinedPatchValues(patch)).toBe(true);
  });

  it('reports an empty patch when every value is undefined', () => {
    const patch = pickDefined<PatchTarget>([
      ['name', undefined],
      ['quantity', undefined],
    ]);

    expect(patch).toEqual({});
    expect(hasDefinedPatchValues(patch)).toBe(false);
  });
});
