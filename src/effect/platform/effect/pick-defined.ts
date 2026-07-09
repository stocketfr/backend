export type DefinedPatchEntry<TTarget extends object> = readonly [
  keyof TTarget,
  TTarget[keyof TTarget] | undefined,
];

export const pickDefined = <TTarget extends object>(
  entries: ReadonlyArray<DefinedPatchEntry<TTarget>>,
): Partial<TTarget> => {
  const patch: Partial<TTarget> = {};

  for (const [key, value] of entries) {
    if (value !== undefined) {
      patch[key] = value;
    }
  }

  return patch;
};

export const hasDefinedPatchValues = (patch: object): boolean =>
  Object.keys(patch).length > 0;
