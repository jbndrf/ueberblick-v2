import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { ensureBuilt, isStale, writeFlavour } from './web-build.mjs';

const dirs = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'ub-webbuild-'));
  dirs.push(root);
  mkdirSync(join(root, 'apps/web/src'), { recursive: true });
  mkdirSync(join(root, 'packages/core/src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, 'apps/web/src/a.ts'), '');
  writeFileSync(join(root, 'packages/core/src/b.ts'), '');
  return root;
}
const touch = (file, secondsAgo) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '');
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(file, t, t);
};
const ageSources = (root) => {
  touch(join(root, 'apps/web/src/a.ts'), 100);
  touch(join(root, 'packages/core/src/b.ts'), 100);
  touch(join(root, 'package.json'), 100);
};
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('isStale', () => {
  it('is true when the build is missing', () => expect(isStale(fixture())).toBe(true));
  it('is true when a source file is newer than the build', () => {
    const root = fixture();
    touch(join(root, 'apps/web/build/index.js'), 100);
    touch(join(root, 'packages/core/src/b.ts'), 10);
    expect(isStale(root)).toBe(true);
  });
  it('is false when the build is newer than every source', () => {
    const root = fixture();
    ageSources(root);
    touch(join(root, 'apps/web/build/index.js'), 10);
    expect(isStale(root)).toBe(false);
  });
  it('ignores node_modules, .svelte-kit and build output', () => {
    const root = fixture();
    ageSources(root);
    touch(join(root, 'apps/web/build/index.js'), 10);
    touch(join(root, 'apps/web/src/node_modules/x.js'), 1);
    touch(join(root, 'packages/core/src/.svelte-kit/x.js'), 1);
    expect(isStale(root)).toBe(false);
  });
});

describe('flavour (WP-1029)', () => {
  const fresh = (flavour) => {
    const root = fixture();
    ageSources(root);
    touch(join(root, 'apps/web/build/index.js'), 10);
    if (flavour) writeFlavour(root, flavour);
    return root;
  };
  it('is stale when the marker is missing', () => expect(isStale(fresh(), { flavour: 'probe' })).toBe(true));
  it('is fresh when the marker matches', () =>
    expect(isStale(fresh('probe'), { flavour: 'probe' })).toBe(false));
  it('is stale when the marker differs', () => {
    expect(isStale(fresh('plain'), { flavour: 'probe' })).toBe(true);
    expect(isStale(fresh('probe'), { flavour: 'plain' })).toBe(true);
  });
  it('accepts any flavour when none is asked for', () => expect(isStale(fresh('probe'))).toBe(false));
  it('is stale when a catalogue or project.inlang file is newer than the build', () => {
    for (const f of [
      'apps/web/messages/de.json',
      'packages/ui/messages/en.json',
      'packages/tools/chat/messages/de.json',
      'packages/ui/project.inlang/settings.json',
    ]) {
      const root = fresh('probe');
      touch(join(root, f), 1);
      expect(isStale(root, { flavour: 'probe' }), f).toBe(true);
    }
  });
  it('ensureBuilt builds with the flavour, writes the marker, and reuses a matching build', async () => {
    const root = fixture();
    ageSources(root);
    const seen = [];
    const build = async (r, opts) => {
      seen.push(opts.flavour);
      touch(join(r, 'apps/web/build/index.js'), 0);
    };
    expect(await ensureBuilt({ root, build, flavour: 'probe' })).toBe(true);
    expect(readFileSync(join(root, 'apps/web/build/.flavour'), 'utf8').trim()).toBe('probe');
    expect(await ensureBuilt({ root, build, flavour: 'probe' })).toBe(false);
    expect(await ensureBuilt({ root, build, flavour: 'plain' })).toBe(true);
    expect(seen).toEqual(['probe', 'plain']);
  });
});

describe('ensureBuilt', () => {
  it('runs the build once for two concurrent callers, and not at all when fresh', async () => {
    const root = fixture();
    ageSources(root);
    let runs = 0;
    const build = async (r) => {
      runs += 1;
      await new Promise((res) => setTimeout(res, 150));
      touch(join(r, 'apps/web/build/index.js'), 0);
    };
    const [a, b] = await Promise.all([
      ensureBuilt({ root, build, pollMs: 10 }),
      ensureBuilt({ root, build, pollMs: 10 }),
    ]);
    expect(runs).toBe(1);
    expect([a, b].sort()).toEqual([false, true]);
    expect(await ensureBuilt({ root, build, pollMs: 10 })).toBe(false);
    expect(runs).toBe(1);
    expect(readdirSync(join(root, 'apps/web'))).not.toContain('.build.lock');
  });
});

describe('stale lock', () => {
  it('takes over a lock whose holder died (dead pid in the lock file)', async () => {
    const root = fixture();
    ageSources(root);
    const deadPid = Number(
      execFileSync('node', ['-e', 'process.stdout.write(String(process.pid))'], {
        encoding: 'utf8',
        env: specEnv(),
      }),
    );
    const lock = join(root, 'apps/web/.build.lock');
    writeFileSync(lock, String(deadPid));
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
    utimesSync(lock, fiveMinAgo, fiveMinAgo);
    let runs = 0;
    const build = async (r) => {
      runs += 1;
      touch(join(r, 'apps/web/build/index.js'), 0);
    };
    const built = await ensureBuilt({ root, build, pollMs: 10 });
    expect(built).toBe(true);
    expect(runs).toBe(1);
    expect(existsSync(lock)).toBe(false);
  });
});

describe('call sites use the helper', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const read = (f) => readFileSync(join(ROOT, f), 'utf8');
  it('demo, seed and journeys call ensureBuilt', () => {
    for (const f of ['scripts/demo/demo.mjs', 'scripts/ui/seed.mjs', 'scripts/ui/journeys.mjs'])
      expect(read(f), f).toMatch(/ensureBuilt\(\)/);
  });
  it('no existsSync on the build file is left in scripts/demo or scripts/ui', () => {
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(join(ROOT, d), { withFileTypes: true }))
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith('.mjs')) files.push(join(d, e.name));
    };
    walk('scripts/demo');
    walk('scripts/ui');
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) expect(read(f), f).not.toMatch(/existsSync\([^\n]*build\/index\.js/);
  });
});
