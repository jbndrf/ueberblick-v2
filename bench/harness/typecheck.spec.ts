import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withPlants } from '../../scripts/testing/plant.mjs';

// WP-159: benches are typechecked, so a contract change cannot break them silently.
describe('bench/ is typechecked (WP-159)', () => {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const scripts = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
  ).scripts;

  it('wires the bench typecheck into `typecheck`, so `check` and the pre-commit hook run it', () => {
    expect(scripts['typecheck']).toContain('typecheck:bench');
    expect(scripts['typecheck:bench']).toContain('bench/tsconfig.json');
  });

  // Bounded work: the bench tsconfig with only the plant as input, not the whole tree (docs/process/planted-files.md).
  it('fails the typecheck on a type error in a bench file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'guardrail-bench-tsc-'));
    try {
      const cfg = join(tmp, 'tsconfig.json');
      const planted = 'bench/x.planted.ts';
      writeFileSync(
        cfg,
        JSON.stringify({
          extends: join(root, 'bench/tsconfig.json'),
          compilerOptions: { types: [] }, // the plant needs no ambient types (a temp dir cannot resolve them)
          include: [join(root, planted)],
          exclude: [], // the tsconfig excludes plants (WP-1022); this one wants it
        }),
      );
      const tsc = (): { ok: boolean; out: string } => {
        const r = spawnSync(`npx tsc -p ${cfg}`, { cwd: root, shell: true, encoding: 'utf8' });
        return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
      };
      const bad = withPlants(root, { [planted]: "export const n: number = 'not a number';\n" }, tsc);
      expect(bad.ok).toBe(false);
      expect(bad.out).toContain('x.planted.ts');
      const good = withPlants(root, { [planted]: 'export const n: number = 1;\n' }, tsc);
      expect(good.ok, good.out).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 60_000);
});
