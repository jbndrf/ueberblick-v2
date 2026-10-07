// WP-1076 guard (R1): core `shortId` (`#` + the last four characters) is the only short id. No source file outside
// core/locale cuts an id into a short form itself (first four characters plus an ellipsis, or a last-N slice).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';

const SKIP = new Set(['node_modules', '.svelte-check', '.svelte-kit', 'dist', 'build', 'locale']);
const SOURCE = /\.(ts|svelte)$/;
const TEST = /\.(spec|test|testing)\.ts$/;
/** A `shortId` or `short` definition, `id.slice(-N)`, and `id.slice(0, N)` followed by an ellipsis. */
const SHORTENER =
  /\bfunction\s+(?:shortId|short)\b|\b(?:const|let)\s+(?:shortId|short)\s*=\s*\(|\bid\.slice\(\s*-\d\s*\)|\bid\.slice\(\s*0\s*,\s*\d\s*\)\}…/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('one short id', () => {
  it('no file outside packages/core/src/locale defines its own', () => {
    const repo = join(new URL('.', import.meta.url).pathname, '../../../..');
    const found = [...walk(join(repo, 'packages')), ...walk(join(repo, 'apps'))]
      .filter((f) => SOURCE.test(f) && !TEST.test(f) && !isPlanted(f))
      .filter((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .some((l) => SHORTENER.test(l)),
      )
      .map((f) =>
        f
          .slice(repo.length + 1)
          .split(sep)
          .join('/'),
      );
    expect(found).toEqual([]);
  });
});
