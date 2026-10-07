import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'paraglide' || n === 'node_modules' || isPlanted(n)) return [];
    return statSync(p).isDirectory()
      ? files(p)
      : /\.(ts|svelte)$/.test(n) && !n.endsWith('.spec.ts')
        ? [p]
        : [];
  });
}

describe('tools load on demand', () => {
  it('the ui package never imports a tool package (the app passes lazy loaders)', () => {
    const root = new URL('..', import.meta.url).pathname;
    const offenders = files(root).filter((f) =>
      /from\s+['"](@ueberblick\/tool-|[./]*\/?packages\/tools)/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
