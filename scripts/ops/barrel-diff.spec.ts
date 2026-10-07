import { describe, expect, it } from 'vitest';
import { barrelDiff } from './barrel-diff.mjs';

// WP-992: the diff of a barrel's re-exports.
const base = `// registry
export { A } from './a';
export type { B } from './b';
export { c as C } from './c';
`;

describe('barrelDiff', () => {
  it('one added named export is added only', () => {
    const r = barrelDiff(base, `${base}export { D } from './d';\n`);
    expect(r).toEqual({ barrel: true, added: [{ name: 'D', from: './d' }], removed: [], changed: [] });
  });

  it('an added type re-export and an aliased one are added', () => {
    const r = barrelDiff(base, `${base}export type { E } from './e';\nexport { f as F } from './f';\n`);
    expect(r.added.map((x) => x.name)).toEqual(['E', 'F']);
    expect(r.removed).toEqual([]);
    expect(r.changed).toEqual([]);
  });

  it('a removed export is removed', () => {
    const r = barrelDiff(base, base.replace("export { A } from './a';\n", ''));
    expect(r).toMatchObject({ barrel: true, added: [], removed: ['A'], changed: [] });
  });

  it('a re-pointed name is changed, also when only the source name or its kind moves', () => {
    expect(barrelDiff(base, base.replace("'./a'", "'./a2'")).changed).toEqual(['A']);
    expect(barrelDiff(base, base.replace('c as C', 'c2 as C')).changed).toEqual(['C']);
    expect(barrelDiff(base, base.replace('export type { B }', 'export { B }')).changed).toEqual(['B']);
  });

  it('an added or removed `export *` is changed, and a new `export * as ns` is added', () => {
    expect(barrelDiff(base, `${base}export * from './all';\n`).changed).toEqual(['*./all']);
    expect(barrelDiff(`${base}export * from './all';\n`, base).changed).toEqual(['*./all']);
    expect(barrelDiff(base, `${base}export * as ns from './ns';\n`).added).toEqual([
      { name: 'ns', from: './ns' },
    ]);
  });

  it('a const, a local export or an import makes the file no barrel; so does a syntax error', () => {
    expect(barrelDiff(base, `${base}export const x = 1;\n`).barrel).toBe(false);
    expect(barrelDiff(`${base}const y = 1;\n`, base).barrel).toBe(false);
    expect(barrelDiff(base, `${base}export { z };\n`).barrel).toBe(false);
    expect(barrelDiff(base, `${base}export { from\n`).barrel).toBe(false);
  });

  it('comments, blank lines and reordering are no change', () => {
    const shuffled = `\n// moved\nexport { c as C } from './c';\n\nexport { A } from './a';\nexport type { B } from './b';\n`;
    expect(barrelDiff(base, shuffled)).toEqual({ barrel: true, added: [], removed: [], changed: [] });
  });
});
