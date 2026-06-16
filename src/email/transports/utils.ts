const URL_PATTERN = /https?:\/\/\S+/g;

export const extractUniqueUrls = (text: string): readonly string[] => [
  ...new Set(text.match(URL_PATTERN) ?? []),
];
