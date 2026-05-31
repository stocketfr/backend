import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendSrc = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const modulesDir = join(backendSrc, 'modules');

const findRepositoryFiles = (dir: string): string[] => {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...findRepositoryFiles(path));
      continue;
    }

    if (entry === 'repository.ts') {
      files.push(path);
    }
  }

  return files;
};

describe('tenant query usage', () => {
  it('keeps request tenant resolution behind TenantQuery in module repositories', () => {
    const offenders = findRepositoryFiles(modulesDir)
      .filter((path) =>
        readFileSync(path, 'utf8').includes('requireRequestTenantId'),
      )
      .map((path) => path.slice(backendSrc.length + 1));

    expect(offenders).toEqual([]);
  });
});
