// WP-588 guard (R1): no source file outside core/locale picks a language out of a LocalizedString itself.
// It must call `localize`, `localizeExact` (or an adapter that does). Lead decision: adapters are fine.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';

/** A resolver reads the first entry of a label map or hard-codes a language key. */
const RESOLVER =
  /Object\.(values|keys|entries)\([^)]*\)\[0\]|\?\.\[['"](de|en)['"]\]|\b\w+\[['"](de|en)['"]\]\s*\?\?/;
const SKIP = new Set(['node_modules', '.svelte-check', '.svelte-kit', 'dist', 'build', 'locale']);
const SOURCE = /\.(ts|svelte)$/;
const TEST = /\.(spec|test|testing)\.ts$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (SKIP.has(n)) return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function offenders(root: string): string[] {
  return walk(root)
    .filter((f) => SOURCE.test(f) && !TEST.test(f) && !isPlanted(f))
    .filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((l) => RESOLVER.test(l) && /label|message|title|text|help/i.test(l)),
    )
    .map((f) =>
      f
        .slice(root.length + 1)
        .split(sep)
        .join('/'),
    );
}

describe('one LocalizedString resolver', () => {
  it('the pattern finds a planted resolver and ignores plants', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wp588-'));
    try {
      mkdirSync(join(tmp, 'a'));
      writeFileSync(join(tmp, 'a', 'bad.ts'), "const t = Object.values(label)[0] ?? 'x';\n");
      writeFileSync(join(tmp, 'a', 'bad2.ts'), "const t = label?.['de'] ?? label?.['en'];\n");
      writeFileSync(join(tmp, 'a', 'ok.ts'), 'const t = localize(label, [locale]);\n');
      writeFileSync(join(tmp, 'a', 'bad.planted.ts'), 'const t = Object.values(label)[0];\n');
      expect(offenders(tmp).sort()).toEqual(['a/bad.ts', 'a/bad2.ts']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('no source file in packages/ or apps/ resolves a label itself', () => {
    const repo = join(new URL('.', import.meta.url).pathname, '../../../..');
    expect([...offenders(join(repo, 'packages')), ...offenders(join(repo, 'apps'))]).toEqual([]);
  });
});
