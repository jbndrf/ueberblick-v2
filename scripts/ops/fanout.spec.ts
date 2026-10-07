import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildGraph, fanoutPerFile, specsFor } from './fanout-graph.mjs';

// WP-990: which specs `vitest related` selects for a changed file, on a small tree with a barrel.
const tree: Record<string, string> = {
  'packages/lib/package.json': JSON.stringify({
    name: '@x/lib',
    exports: { '.': './src/index.ts', './b': './src/b.ts' },
  }),
  'packages/lib/src/index.ts': "export { a } from './a';\nexport * from './b';\nexport { c } from './c';\n",
  'packages/lib/src/a.ts': 'export const a = 1;\n',
  'packages/lib/src/b.ts': 'export const b = 2;\n',
  'packages/lib/src/c.ts': "import { a } from './a';\nexport const c = a;\n",
  'packages/lib/src/viaBarrel.spec.ts': "import { b } from '@x/lib';\nvoid b;\n",
  'packages/lib/src/viaBarrelOther.spec.ts': "import { a } from '@x/lib';\nvoid a;\n",
  'packages/lib/src/direct.spec.ts': "import { b } from '@x/lib/b';\nvoid b;\n",
  'packages/lib/src/typed.spec.ts': "import { type c } from '@x/lib';\n",
  'apps/web/src/lib/u.ts': 'export const u = 1;\n',
  'apps/web/src/lib/u.spec.ts': "import { u } from '$lib/u';\nvoid u;\n",
};
let root = '';
const files = Object.keys(tree);
const specs = files.filter((f) => f.endsWith('.spec.ts'));
const L = (n: string) => `packages/lib/src/${n}`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fanout-'));
  for (const [f, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('fan-out of a changed file', () => {
  it('a leaf behind the barrel selects every importer of the barrel', () => {
    const g = buildGraph(root, files);
    expect(specsFor(g, specs, [L('c.ts')])).toEqual(
      [L('typed.spec.ts'), L('viaBarrel.spec.ts'), L('viaBarrelOther.spec.ts')].sort(),
    );
  });

  it('a direct import counts only its importers', () => {
    const g = buildGraph(root, files);
    expect(specsFor(g, specs, [L('b.ts')])).toContain(L('direct.spec.ts'));
    expect(specsFor(g, specs, [L('direct.spec.ts')])).toEqual([L('direct.spec.ts')]);
    expect(specsFor(g, specs, ['apps/web/src/lib/u.ts'])).toEqual(['apps/web/src/lib/u.spec.ts']);
  });

  it('barrel-aware selection follows only the re-exports a spec imports', () => {
    const g = buildGraph(root, files);
    const only = { barrels: 'all' as const, eraseTypes: true };
    expect(specsFor(g, specs, [L('c.ts')], only)).toEqual([]);
    expect(specsFor(g, specs, [L('b.ts')], only)).toEqual(
      [L('direct.spec.ts'), L('viaBarrel.spec.ts')].sort(),
    );
  });

  it('an inline type-only import keeps the module unless erased', () => {
    const g = buildGraph(root, files);
    expect(specsFor(g, specs, [L('c.ts')], { barrels: 'all' })).toEqual([L('typed.spec.ts')]);
    expect(specsFor(g, specs, [L('a.ts')], { barrels: 'all', eraseTypes: true })).not.toContain(
      L('typed.spec.ts'),
    );
  });

  it('counts specs per source file', () => {
    const n = fanoutPerFile(buildGraph(root, files), specs);
    expect(n.get(L('c.ts'))).toBe(3);
    expect(n.get(L('b.ts'))).toBe(4);
    expect(n.get(L('direct.spec.ts'))).toBe(1);
  });
});
