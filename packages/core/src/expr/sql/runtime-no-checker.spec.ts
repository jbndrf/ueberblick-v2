// WP-579: the run-time halves of the expression language never import the checker by value. Plants a file and runs the real depcruise rule.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withPlants } from '../../../../../scripts/testing/plant.mjs';

const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const planted = 'packages/core/src/expr/sql/lib.planted.ts';

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

describe('runtime-no-checker (WP-579)', () => {
  it('fails on a value import of the checker tables', () => {
    const r = cruise(
      "import { HISTORY_FUNCTIONS } from '../check/functions';\nexport const h = HISTORY_FUNCTIONS;\n",
    );
    expect(r.ok).toBe(false);
    expect(r.out).toContain('runtime-no-checker');
  }, 60_000);

  it('passes on a type-only import of the checker', () => {
    const r = cruise("import type { TypedAst } from '../check/check';\nexport type T = TypedAst;\n");
    expect(r.out).not.toContain('runtime-no-checker');
  }, 60_000);
});
