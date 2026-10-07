// WP-138: one plant convention. The scan skips plants, specs create them through the helper.
import { spawn } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanRepo } from '../glossary-lint.mjs';
import { isPlanted, plant } from './plant.mjs';
import { specEnv } from './spec-env.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('plant helper', () => {
  it('recognises plant names in any path segment', () => {
    expect(isPlanted('packages/ui/src/a.planted.ts')).toBe(true);
    expect(isPlanted('packages/ui/src/a.planted.testkit.ts')).toBe(true);
    expect(isPlanted('apps/web/src/routes/x.planted/participant.ts')).toBe(true);
    expect(isPlanted('packages/ui/src/a.ts')).toBe(false);
  });

  it('refuses a name outside the convention', () => {
    expect(() => plant(root, { 'packages/core/src/plain.ts': 'export {};' })).toThrow(/convention/);
  });
});

describe('glossary-lint versus planted files (WP-138)', () => {
  // WP-143: the race runs in a temp root, so no plant ever enters the real packages/ tree (other specs run depcruise there).
  it('a concurrent plant loop never makes scanRepo throw or report a plant', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'plant-race-'));
    mkdirSync(join(tmp, 'packages/core/src'), { recursive: true });
    writeFileSync(join(tmp, 'packages/core/src/real.ts'), 'export const feature = 1;\n');
    // A child process plants and removes files (some with banned terms) while this process scans in a loop.
    const script = `
      import { plant } from ${JSON.stringify(new URL('./plant.mjs', import.meta.url).href)};
      const end = Date.now() + 4000;
      while (Date.now() < end) {
        const p = plant(${JSON.stringify(tmp)}, {
          'packages/core/src/race-a.planted.ts': 'export const workflow_instance = 1;\\n',
          'packages/core/src/race-dir.planted/inner.ts': 'export const fieldDef = 1;\\n',
        });
        p.remove();
      }`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      stdio: 'inherit',
      env: specEnv(),
    });
    let finished = false;
    child.on('exit', () => (finished = true));
    let scans = 0;
    while (!finished) {
      const { files, problems } = scanRepo([join(tmp, 'packages')]);
      expect(files.filter((f) => f.includes('.planted'))).toEqual([]);
      expect(problems).toEqual([]);
      scans++;
      await new Promise((r) => setTimeout(r, 0));
    }
    rmSync(tmp, { recursive: true, force: true });
    expect(scans).toBeGreaterThan(1);
  }, 60_000);

  it('still fails on an ENOENT that is not a plant (a dangling link)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'plant-enoent-'));
    try {
      symlinkSync(join(tmp, 'gone.ts'), join(tmp, 'dangling.ts'));
      expect(() => scanRepo([tmp])).toThrow(/ENOENT/);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('planted-file specs use the helper (WP-138)', () => {
  const specs: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir)) {
      if (e === 'node_modules' || e.startsWith('.') || e === 'dist' || isPlanted(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.spec\.ts$/.test(e)) specs.push(p);
    }
  };
  walk(join(root, 'packages'));
  walk(join(root, 'apps'));
  walk(join(root, 'e2e'));
  walk(join(root, 'fixtures'));

  it('no spec under packages/ or apps/ writes files without the plant helper', () => {
    const offenders = specs.filter((f) => {
      const text = readFileSync(f, 'utf8');
      const writes = /\b(writeFileSync|writeFile|appendFileSync|copyFileSync)\b/.test(text);
      const usesHelper = /testing\/plant\.mjs/.test(text);
      // Specs that write into a tmp dir (mkdtemp) are not plants; they never touch the repo tree.
      return writes && !usesHelper && !/mkdtemp|tmpdir/.test(text);
    });
    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });

  // WP-152: a plant lives in the real tree for one tool call only. `plant()` (create now, remove later) is for
  // temp roots; specs under packages/ and apps/ use `withPlants`, which removes in `finally`.
  it('no spec under packages/, apps/, e2e/ or fixtures/ holds plants across calls (only withPlants)', () => {
    const offenders = specs.filter((f) => {
      const m = /import\s*\{([^}]*)\}\s*from\s*'[^']*testing\/plant\.mjs'/.exec(readFileSync(f, 'utf8'));
      return (m?.[1] ?? '').split(',').some((n) => n.trim() === 'plant');
    });
    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });

  // WP-152: a spec that walks a source tree recursively sees plants that other specs have in flight (ENOENT on
  // a removed one, or a plant read as source). It must skip them with `isPlanted`, or walk a mkdtemp root.
  const walksWithoutSkip = (text: string): boolean =>
    /\breaddir(Sync)?\b/.test(text) &&
    /isDirectory\(\)|recursive:\s*true|withFileTypes/.test(text) &&
    !/isPlanted|mkdtemp|tmpdir/.test(text);

  it('the walk check flags a recursive walker without a plant skip (and accepts the two fixes)', () => {
    const walker =
      'const w = (d) => readdirSync(d).flatMap((n) => statSync(join(d, n)).isDirectory() ? w(join(d, n)) : [n]);';
    expect(walksWithoutSkip(walker)).toBe(true);
    expect(walksWithoutSkip(`${walker} // isPlanted(n)`)).toBe(false);
    expect(walksWithoutSkip(`${walker} mkdtempSync(x)`)).toBe(false);
    expect(walksWithoutSkip("readFileSync('a.ts')")).toBe(false);
  });

  it('no spec walks the real tree without skipping plants (isPlanted) or using a temp root', () => {
    const offenders = specs.filter((f) => walksWithoutSkip(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.slice(root.length))).toEqual([]);
  });

  // Two specs planting the same path clobber each other under parallel runs (isolation.spec and
  // guardrails.spec both used apps/web/src/lib/lib.planted.ts and one removed the other's plant).
  it('no two specs plant the same path', () => {
    const owners = new Map<string, Set<string>>();
    const all = [...specs, join(root, 'scripts/guardrails.spec.ts')];
    for (const f of all) {
      for (const [, path = ''] of readFileSync(f, 'utf8').matchAll(
        /'((?:packages|apps)\/[^']*\.planted[^']*)'/g,
      )) {
        const set = owners.get(path) ?? new Set<string>();
        set.add(f.slice(root.length));
        owners.set(path, set);
      }
    }
    const shared = [...owners].filter(([, s]) => s.size > 1).map(([p, s]) => `${p}: ${[...s].join(', ')}`);
    expect(shared).toEqual([]);
  });

  it('the planted-file specs import it', () => {
    for (const f of [
      'packages/server/src/store/boundary.spec.ts',
      'packages/builder/src/shell/isolation.spec.ts',
      'packages/client/src/participant-imports.spec.ts',
      'scripts/guardrails.spec.ts',
    ]) {
      expect(readFileSync(join(root, f), 'utf8'), f).toContain('testing/plant.mjs');
    }
  });
});
