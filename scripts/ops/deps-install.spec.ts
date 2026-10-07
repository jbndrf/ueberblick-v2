import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { depsInstall } from './deps-install.mjs';
import { MARKER } from './link-node-modules.mjs';

// Fixture dirs under the OS temp dir; the real checkout's node_modules is never touched.
let base: string;
let main: string;
let seq = 0;
const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: { '': {}, 'node_modules/fx': { version: '1.0.0', integrity: 'x', resolved: 'r' } },
});
const write = (f: string, text: string) => {
  mkdirSync(join(f, '..'), { recursive: true });
  writeFileSync(f, text);
};
const wt = (lock = LOCK) => {
  const d = join(base, `wt-${++seq}`);
  write(join(d, 'package-lock.json'), lock);
  return d;
};
const run = (worktree: string, mainDir = main) => {
  const lines: string[] = [];
  const calls: string[] = [];
  const r = depsInstall({
    worktree,
    main: mainDir,
    say: (l) => lines.push(l),
    npmCi: (cwd) => (calls.push(cwd), 0),
  });
  return { r, lines, calls };
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'deps-install-'));
  main = join(base, 'main');
  write(join(main, 'package-lock.json'), LOCK);
  write(join(main, 'node_modules/fx/index.js'), 'main');
  write(join(main, 'node_modules/.package-lock.json'), LOCK);
  write(join(main, 'node_modules/.vite/cache'), 'main cache');
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('deps:install', () => {
  it('replaces a real install with a hardlink when the lockfile matches main', () => {
    const d = wt();
    write(join(d, 'node_modules/old/index.js'), 'old');
    const { r, lines, calls } = run(d);
    expect(r.action).toBe('linked');
    expect(calls).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^deps:install: linked from main \(\d+ ms\)$/);
    expect(existsSync(join(d, 'node_modules/old'))).toBe(false);
    expect(lstatSync(join(d, 'node_modules/fx/index.js')).ino).toBe(
      lstatSync(join(main, 'node_modules/fx/index.js')).ino,
    );
    expect(existsSync(join(d, 'node_modules', MARKER))).toBe(true);
  });

  it('links a worktree that lives inside the main checkout (.claude/worktrees)', () => {
    const d = join(main, '.claude/worktrees/inner');
    write(join(d, 'package-lock.json'), LOCK);
    write(join(d, 'node_modules/.vite/own'), 'own');
    expect(run(d).r.action).toBe('linked');
    expect(existsSync(join(d, 'node_modules/fx/index.js'))).toBe(true);
    expect(existsSync(join(main, 'node_modules/fx/index.js'))).toBe(true);
  });

  it('recreates a runtime cache instead of sharing it', () => {
    const d = wt();
    write(join(d, 'node_modules/.vite/own'), 'own');
    run(d);
    expect(existsSync(join(d, 'node_modules/.vite'))).toBe(false);
    expect(readFileSync(join(main, 'node_modules/.vite/cache'), 'utf8')).toBe('main cache');
  });

  it('runs npm ci and says why when the lockfile differs', () => {
    const d = wt(LOCK + ' ');
    write(join(d, 'node_modules/keep'), 'k');
    const { r, lines, calls } = run(d);
    expect(r.action).toBe('npm-ci');
    expect(calls).toEqual([d]);
    expect(lines).toEqual(["deps:install: npm ci (package-lock.json differs from main's)"]);
    expect(existsSync(join(d, 'node_modules/keep'))).toBe(true);
  });

  it("runs npm ci and says why when main's install is stale", () => {
    const stale = join(base, 'stale-main');
    write(join(stale, 'package-lock.json'), LOCK);
    write(join(stale, 'node_modules/.package-lock.json'), LOCK.replace('1.0.0', '0.9.0'));
    const { lines, calls } = run(wt(), stale);
    expect(calls).toHaveLength(1);
    expect(lines[0]).toMatch(/^deps:install: npm ci \(main's install is stale/);
  });

  it('in the main checkout runs npm ci and leaves node_modules untouched', () => {
    const { r, lines, calls } = run(main);
    expect(r.action).toBe('npm-ci');
    expect(calls).toEqual([main]);
    expect(lines).toEqual(['deps:install: npm ci (this is the main checkout)']);
    expect(readFileSync(join(main, 'node_modules/fx/index.js'), 'utf8')).toBe('main');
  });

  it('refuses to delete a node_modules that resolves into main', () => {
    const d = wt();
    mkdirSync(d, { recursive: true });
    symlinkSync(join(main, 'node_modules'), join(d, 'node_modules'));
    expect(() => run(d)).toThrow(/refusing to remove/);
    expect(existsSync(join(main, 'node_modules/fx/index.js'))).toBe(true);
  });
});
