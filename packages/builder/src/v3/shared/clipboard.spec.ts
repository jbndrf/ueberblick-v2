// WP-451: one clipboard helper; no copy button writes to the clipboard on its own (R1).
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';
import { copyText } from './clipboard';

const v3 = join(import.meta.dirname, '..');
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

afterEach(() => vi.unstubAllGlobals());

describe('copyText', () => {
  it('writes the text and says true', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    expect(await copyText('abc')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('says false when the clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    expect(await copyText('abc')).toBe(false);
  });
});

describe('the one helper', () => {
  it('no source under builder/src/v3 calls navigator.clipboard except shared/clipboard.ts', () => {
    const offenders = walk(v3)
      .filter((f) => /\.(ts|svelte)$/.test(f) && !f.endsWith('.spec.ts') && !isPlanted(f))
      .filter((f) => !f.endsWith(join('shared', 'clipboard.ts')))
      .filter((f) => /navigator\.clipboard/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(v3, f))).toEqual([]);
  });
});
