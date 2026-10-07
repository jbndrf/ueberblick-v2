import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

describe('one view-pass wiring (R1)', () => {
  it('deviceViewPassOf is called only by recordViewPassOf', () => {
    const root = new URL('../../', import.meta.url).pathname;
    const hits = globSync('**/*.{svelte,ts}', { cwd: root })
      .filter((f) => !f.endsWith('.spec.ts'))
      .filter((f) => /deviceViewPassOf\(/.test(readFileSync(root + f, 'utf8')));
    expect(hits.sort()).toEqual(['sheets/filter/view-pass.ts']);
  });
});
