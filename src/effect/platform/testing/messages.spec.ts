import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { enCatalog } from '../catalogs';
import {
  messageCatalogs,
  localizeMessageTree,
} from '../observability/messages';

const collectSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (entry === '__fixtures__') return [];
      return collectSourceFiles(path);
    }

    if (
      !entry.endsWith('.ts') ||
      entry.endsWith('.spec.ts') ||
      entry.endsWith('.integration.spec.ts')
    ) {
      return [];
    }

    return [path];
  });

const literalMessageKeysIn = (filePath: string) => {
  const content = readFileSync(filePath, 'utf8');
  const patterns = [
    /messageKey:\s*['"`]([^'"`]+)['"`]/g,
    /makeMessageResponse\(\s*['"`]([^'"`]+)['"`]/g,
    /translateMessage\(\s*[^,\n]+,\s*['"`]([^'"`]+)['"`]/g,
  ];

  return patterns.flatMap((pattern) =>
    [...content.matchAll(pattern)]
      .map((match) => match[1]!)
      .filter((messageKey) => !messageKey.includes('${')),
  );
};

describe('localizeMessageTree', () => {
  it('preserves Date objects so JSON responses serialize them as ISO strings', () => {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    const result = localizeMessageTree(
      { data: [{ id: 'log-1', created_at: createdAt }] },
      'en',
    );

    expect(result).toEqual({ data: [{ id: 'log-1', created_at: createdAt }] });
    expect(JSON.stringify(result)).toContain(
      '"created_at":"2026-01-01T00:00:00.000Z"',
    );
  });
});

describe('message catalog coverage', () => {
  it('keeps locale catalogs in sync', () => {
    const expectedKeys = Object.keys(enCatalog).sort();

    for (const [locale, catalog] of Object.entries(messageCatalogs)) {
      expect(Object.keys(catalog).sort(), locale).toEqual(expectedKeys);
    }
  });

  it('contains every production messageKey literal', () => {
    const catalogKeys = new Set(Object.keys(enCatalog));
    const sourceRoots = [
      join(process.cwd(), 'src/effect/modules'),
      join(process.cwd(), 'src/effect/platform'),
    ];

    const missing = sourceRoots
      .flatMap(collectSourceFiles)
      .flatMap((filePath) =>
        literalMessageKeysIn(filePath).map((messageKey) => ({
          filePath,
          messageKey,
        })),
      )
      .filter(({ messageKey }) => !catalogKeys.has(messageKey));

    expect(missing).toEqual([]);
  });
});
