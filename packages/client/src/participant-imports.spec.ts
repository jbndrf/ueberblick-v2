// WP-122.1: participant code imports core subpaths only. Each case plants a file and runs the real depcruise rule.
import { spawnSync } from 'node:child_process';
import { withPlants } from '../../../scripts/testing/plant.mjs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const planted = 'packages/ui/src/lib.planted.ts';

function cruise(src: string): { ok: boolean; out: string } {
  const r = withPlants(root, { [planted]: src }, () =>
    spawnSync(`npx depcruise ${planted} --config .dependency-cruiser.cjs`, {
      cwd: root,
      shell: true,
      encoding: 'utf8',
    }),
  );
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

describe('participant code imports core subpaths only (WP-122.1)', () => {
  it('fails on a root import', () => {
    const r = cruise("import { evaluate } from '@ueberblick/core';\nexport const e = evaluate;\n");
    expect(r.ok).toBe(false);
    expect(r.out).toContain('participant-core-subpaths');
  }, 60_000);

  it('fails on a value import of /schema, /compile or /template', () => {
    for (const sub of ['schema', 'compile', 'template']) {
      const r = cruise(`import * as m from '@ueberblick/core/${sub}';\nexport const e = m;\n`);
      expect(r.ok, sub).toBe(false);
    }
  }, 120_000);

  it('fails on a type-only import of the root barrel, /compile and /schema (WP-129.2)', () => {
    for (const sub of ['', '/compile', '/schema']) {
      const r = cruise(`import type { View } from '@ueberblick/core${sub}';\nexport type V = View;\n`);
      expect(r.ok, sub).toBe(false);
      expect(r.out, sub).toContain('participant-core-subpaths');
    }
  }, 120_000);

  it('passes on a subpath import and on a type import from /model', () => {
    const r = cruise(
      "import { evaluate } from '@ueberblick/core/expr';\nimport type { View } from '@ueberblick/core/model';\nexport type V = View;\nexport const e = evaluate;\n",
    );
    expect(r.out).not.toContain('participant-');
    expect(r.ok).toBe(true);
  }, 60_000);
});

// WP-129.1: no-circular ignores cycles made only of type-only edges. Plants live outside packages/ (glossary-lint).
function cruiseCycle(aImportsB: string, bImportsA: string): { ok: boolean; out: string } {
  const r = withPlants(
    root,
    {
      '.planted-cycle/a.planted.ts': `${aImportsB}\nexport const a = 1;\nexport type A = number;\n`,
      '.planted-cycle/b.planted.ts': `${bImportsA}\nexport const b = 1;\nexport type B = number;\n`,
    },
    () =>
      spawnSync('npx depcruise .planted-cycle --config .dependency-cruiser.cjs', {
        cwd: root,
        shell: true,
        encoding: 'utf8',
      }),
  );
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

describe('no-circular counts value edges only (WP-129.1)', () => {
  it('fails on a pure value cycle', () => {
    const r = cruiseCycle(
      "import { b } from './b.planted';\nexport const x = b;",
      "import { a } from './a.planted';\nexport const y = a;",
    );
    expect(r.ok).toBe(false);
    expect(r.out).toContain('no-circular');
  }, 60_000);

  it('fails on a mixed cycle whose value edges still close it', () => {
    const r = cruiseCycle(
      "import { b } from './b.planted';\nimport type { B } from './b.planted';\nexport const x: B = b;",
      "import { a } from './a.planted';\nexport const y = a;",
    );
    expect(r.ok).toBe(false);
    expect(r.out).toContain('no-circular');
  }, 60_000);

  it('passes on a cycle of type-only edges', () => {
    const r = cruiseCycle(
      "import type { B } from './b.planted';\nexport type X = B;",
      "import type { A } from './a.planted';\nexport type Y = A;",
    );
    expect(r.out).not.toContain('no-circular');
    expect(r.ok).toBe(true);
  }, 60_000);
});
