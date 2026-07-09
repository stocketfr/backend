import type {
  LabeledStorageLocationParseOptions,
  StorageLocationSegmentLabel,
} from './types';

export function normalizeStorageLocationName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, ' - ')
    .replace(/\s*\/\s*/g, ' / ');
}

export const joinAreaPath = (segments: readonly string[]): string =>
  segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(' / ');

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeLabelValue = (value: string): string => {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (/^[a-z]{1,3}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  return trimmed;
};

const normalizeLabeledSegment = (
  segment: string,
  labels: readonly StorageLocationSegmentLabel[],
): string | null => {
  const trimmed = segment.trim().replace(/\s+/g, ' ');
  if (trimmed === '') return null;

  for (const label of labels) {
    const match = trimmed.match(
      new RegExp(`^${escapeRegExp(label.keyword)}\\s+(.+)$`, 'i'),
    );
    if (match?.[1]) {
      return `${label.displayName} ${normalizeLabelValue(match[1])}`;
    }
  }

  return null;
};

const splitDelimitedSegments = (
  sourceLocation: string,
  options: LabeledStorageLocationParseOptions,
): string[] => {
  const rawSegments = sourceLocation
    .split(options.separatorPattern)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (rawSegments.length < 2) return [];

  const segments = rawSegments.flatMap((segment) => {
    const normalized = normalizeLabeledSegment(segment, options.labels);
    return normalized ? [normalized] : [];
  });

  return segments.length === rawSegments.length ? segments : [];
};

const splitCompactLabeledSegments = (
  sourceLocation: string,
  options: LabeledStorageLocationParseOptions,
): string[] => {
  const labelPattern = options.labels.map((label) =>
    escapeRegExp(label.keyword),
  );
  const regex = new RegExp(`\\b(${labelPattern.join('|')})\\b`, 'gi');
  const matches = [...sourceLocation.matchAll(regex)];
  if (matches.length < 2) return [];

  const segments = matches.flatMap((match, index) => {
    const start = match.index;
    const end = matches[index + 1]?.index ?? sourceLocation.length;
    if (start === undefined) return [];
    const normalized = normalizeLabeledSegment(
      sourceLocation.slice(start, end),
      options.labels,
    );
    return normalized ? [normalized] : [];
  });

  return segments.length === matches.length ? segments : [];
};

export const parseLabeledStorageLocationSegments = (
  sourceLocation: string,
  options: LabeledStorageLocationParseOptions,
): readonly string[] => {
  const normalized = normalizeStorageLocationName(sourceLocation);
  const delimitedSegments = splitDelimitedSegments(normalized, options);
  if (delimitedSegments.length >= 2) return delimitedSegments;

  const compactSegments = splitCompactLabeledSegments(normalized, options);
  return compactSegments.length >= 2 ? compactSegments : [];
};
