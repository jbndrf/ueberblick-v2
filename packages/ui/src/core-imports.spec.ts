// WP-562: participant UI takes every core type from @ueberblick/core/model, never the root barrel or /compile.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isPlanted } from '../../../scripts/testing/plant.mjs';
import { describe, expect, it } from 'vitest';

const root = new URL('.', import.meta.url).pathname;
const BAD = /from '@ueberblick\/core(\/compile)?'/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('ui core imports', () => {
  it('no non-test ui file imports the core root barrel or /compile', () => {
    const offenders = walk(root)
      .filter((f) => !/\.(spec|test|testing)\.ts$/.test(f) && !isPlanted(f))
      .filter((f) => BAD.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });
});
