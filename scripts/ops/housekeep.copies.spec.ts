import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { specEnv } from '../testing/spec-env.mjs';
import { addWorktree, git, run, setupEnv, teardownEnv } from './housekeep.fixture';
import { createHash } from 'node:crypto';
import { lockHash } from './vitest-cache.mjs';
import { applyAll, plan, remove, type Candidate } from './housekeep.mjs';

let repo: string;
let tmp: string;
beforeEach(() => {
  ({ repo, tmp } = setupEnv());
});
afterEach(teardownEnv);

const LOCK = JSON.stringify({ lockfileVersion: 3, packages: {} });
const TS = ['node_modules', 'typescript', 'lib', 'typescript.js'];

/** Main gets a current install; worktrees get real (not linked) copies of it. */
function mainInstall() {
  writeFileSync(join(repo, 'package-lock.json'), LOCK);
  realCopy(repo, LOCK);
}
function realCopy(dir: string, lock: string) {
  if (dir !== repo) writeFileSync(join(dir, 'package-lock.json'), lock);
  mkdirSync(join(dir, ...TS.slice(0, -1)), { recursive: true });
  writeFileSync(join(dir, ...TS), 'ts');
  writeFileSync(join(dir, 'node_modules', '.package-lock.json'), LOCK);
}
const copies = () => run().candidates.filter((c) => c.kind === 'copy');

describe('housekeep cache candidate', () => {
  const cache = () => join(tmp, 'node-compile-cache');
  const fill = (dir: string, mb: number) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'blob'), '');
    truncateSync(join(dir, 'blob'), mb * 1024 * 1024);
  };

  it('is a candidate over 200 MB and removed by apply', () => {
    fill(cache(), 201);
    const c = run().candidates.filter((x) => x.kind === 'cache');
    expect(c.map((x) => x.path)).toEqual([cache()]);
    expect(c[0]?.kb).toBeGreaterThan(200 * 1024);
    expect(remove(c[0] as Candidate, { repo })).toBe('');
    expect(existsSync(cache())).toBe(false);
  });

  it('is not a candidate at 199 MB', () => {
    fill(cache(), 199);
    expect(run().candidates).toEqual([]);
  });

  it('never touches /tmp/claude-* or other big tmp dirs', () => {
    fill(join(tmp, 'claude-1000', 'node-compile-cache'), 300);
    fill(join(tmp, 'other'), 300);
    expect(run().candidates).toEqual([]);
  });
});

describe('housekeep copy candidate', () => {
  it('relinks a real copy with an equal lockfile and never runs npm ci', () => {
    mainInstall();
    const dir = addWorktree('real');
    realCopy(dir, LOCK);
    const ts = join(dir, ...TS);
    expect(statSync(ts).nlink).toBe(1);
    const found = copies();
    expect(found).toHaveLength(1);
    expect(found[0]?.kb).toBeGreaterThan(0);
    expect(remove(found[0] as Candidate, { repo })).toBe('');
    expect(statSync(ts).nlink).toBeGreaterThan(1);
    expect(copies()).toEqual([]);
  });

  it('keeps a copy where a live process works and reports it', () => {
    mainInstall();
    const dir = addWorktree('busy');
    realCopy(dir, LOCK);
    const { candidates, skipped } = run({ procCwds: () => [join(dir, 'packages')] });
    expect(candidates.filter((c) => c.kind === 'copy')).toEqual([]);
    expect(skipped.filter((s) => s.kind === 'copy').map((s) => s.reason)).toEqual([
      'a live process works inside it',
    ]);
  });

  it('skips a differing lockfile', () => {
    mainInstall();
    realCopy(addWorktree('diff'), JSON.stringify({ lockfileVersion: 3, packages: { x: {} } }));
    expect(copies()).toEqual([]);
  });

  it('skips everything when main install is stale', () => {
    mainInstall();
    const lock = JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/a': { version: '1.0.0' } } });
    writeFileSync(join(repo, 'package-lock.json'), lock);
    realCopy(addWorktree('stale'), lock);
    expect(copies()).toEqual([]);
  });

  it('skips a copy that is already linked', () => {
    mainInstall();
    const dir = addWorktree('linked');
    writeFileSync(join(dir, 'package-lock.json'), LOCK);
    execFileSync('cp', ['-al', join(repo, 'node_modules'), join(dir, 'node_modules')], { env: specEnv() });
    expect(copies()).toEqual([]);
  });

  it('skips the -land staging worktree and includes -docsync-* dirs', () => {
    mainInstall();
    const land = `${repo}-land`;
    git(repo, 'worktree', 'add', '-q', '--detach', land, 'main');
    realCopy(land, LOCK);
    const doc = `${repo}-docsync-1`;
    git(repo, 'worktree', 'add', '-q', '--detach', doc, 'main');
    realCopy(doc, LOCK);
    expect(copies().map((c) => c.path)).toEqual([doc]);
  });
});

describe('housekeep vitest-cache candidate', () => {
  const root = (dir: string) => join(dir, 'node_modules', '.cache', 'vitest-modules');
  const hash = (dir: string, name: string, ageS: number) => {
    const p = join(root(dir), name);
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, 'm.js'), 'x');
    const t = new Date(Date.now() - ageS * 1000);
    utimesSync(p, t, t);
  };
  const found = () => run().candidates.filter((c) => c.kind === 'vitest-cache');

  const LOCKFILE = '{"lockfileVersion":3}';
  const current = createHash('sha1').update(LOCKFILE).digest('hex').slice(0, 12);
  const withLock = (dir: string) => writeFileSync(join(dir, 'package-lock.json'), LOCKFILE);
  const file = (dir: string, name: string, ageS: number, bytes = 10) => {
    const p = join(root(dir), current, name);
    mkdirSync(join(root(dir), current), { recursive: true });
    writeFileSync(p, 'x'.repeat(bytes));
    const t = new Date(Date.now() - ageS * 1000);
    utimesSync(p, t, t);
    return p;
  };
  const trims = (softMb: number) =>
    plan({ repo, cacheSoftMb: softMb }).candidates.filter((c) => c.kind === 'vitest-cache' && c.files);

  it('main keeps only the current lockfile hash dir; the others are candidates, non-hex names are ignored', () => {
    withLock(repo);
    hash(repo, 'aaaa01', 400);
    hash(repo, current, 300);
    hash(repo, 'dddd04', 100);
    hash(repo, 'not-hex', 900);
    const c = found();
    expect(c.map((x) => x.path).sort()).toEqual([join(root(repo), 'aaaa01'), join(root(repo), 'dddd04')]);
    for (const x of c) expect(remove(x as Candidate, { repo })).toBe('');
    expect(existsSync(join(root(repo), 'aaaa01'))).toBe(false);
    expect(existsSync(join(root(repo), current))).toBe(true);
    expect(existsSync(join(root(repo), 'not-hex'))).toBe(true);
    expect(found()).toEqual([]);
  });

  it('a worktree keeps its 2 newest hash dirs (WP-993 rule unchanged)', () => {
    const w = addWorktree('vc-two', { fresh: true });
    for (const [i, n] of ['a1', 'b2', 'c3'].entries()) hash(w, n, 300 - i * 100);
    expect(found().map((x) => x.path)).toEqual([join(root(w), 'a1')]);
  });

  it('covers the -land checkout with its own lockfile', () => {
    const land = `${repo}-land`;
    git(repo, 'worktree', 'add', '-q', '--detach', land, 'main');
    withLock(land);
    hash(land, 'a1', 300);
    hash(land, current, 200);
    expect(found().map((x) => x.path)).toEqual([join(root(land), 'a1')]);
  });

  it('an active dir over the limit loses entries older than 24 h, oldest first, never one under 1 h', () => {
    withLock(repo);
    const f30h = file(repo, 'a.js', 30 * 3600, 1000);
    const f31h = file(repo, 'b.js', 31 * 3600, 1000);
    const f10h = file(repo, 'c.js', 10 * 3600, 1000);
    const f30m = file(repo, 'd.js', 1800, 1000);
    const c = trims(0.0001);
    expect(c).toHaveLength(1);
    expect(c[0]?.files?.sort()).toEqual([f30h, f31h].sort());
    expect(c[0]?.report).toMatch(/vitest module cache: .* 2 entries, \d+ MB freed/);
    expect(remove(c[0] as Candidate, { repo })).toBe('');
    for (const f of [f30h, f31h]) expect(existsSync(f)).toBe(false);
    for (const f of [f10h, f30m]) expect(existsSync(f)).toBe(true);
    expect(trims(0.0001)).toEqual([]);
  });

  it('stops as soon as the dir is under the limit', () => {
    withLock(repo);
    const oldest = file(repo, 'a.js', 40 * 3600, 600);
    file(repo, 'b.js', 30 * 3600, 600);
    expect(trims(1000 / 1048576)[0]?.files).toEqual([oldest]);
  });

  it('under the limit nothing is a candidate, and apply prints the entries and MB', () => {
    withLock(repo);
    file(repo, 'a.js', 40 * 3600, 100);
    expect(trims(1024)).toEqual([]);
    const lines: string[] = [];
    expect(applyAll(trims(0.00001), repo, (l) => lines.push(l))).toBe(0);
    expect(lines.some((l) => /^vitest module cache: .* 1 entries, \d+ MB freed$/.test(l))).toBe(true);
  });

  it('keeps an entry that was rewritten between plan and apply', () => {
    withLock(repo);
    const f = file(repo, 'a.js', 40 * 3600, 1000);
    const c = trims(0.0001);
    utimesSync(f, new Date(), new Date());
    expect(remove(c[0] as Candidate, { repo })).toBe('');
    expect(existsSync(f)).toBe(true);
  });

  it('lockHash is the 12-character sha1 of package-lock.json, the module cache dir vitest.config.ts uses', () => {
    withLock(repo);
    expect(lockHash(repo)).toBe(current);
    expect(lockHash(join(repo, 'nowhere'))).toBeNull();
  });

  // WP-993: a worktree's whole cache goes when idle over 3 h or when its branch landed; main and -land keep theirs.
  const age = (dir: string, h: number) => {
    const t = new Date(Date.now() - h * 3_600_000);
    for (const p of [join(root(dir), 'aa11', 'm.js'), join(root(dir), 'aa11'), root(dir)])
      utimesSync(p, t, t);
  };
  const whole = () => found().filter((x) => x.path === root(x.base as string));

  it('worktree cache idle 4 h is a candidate, idle 1 h is kept', () => {
    const stale = addWorktree('vc-stale', { fresh: true });
    const fresh = addWorktree('vc-fresh', { fresh: true });
    for (const [d, h] of [
      [stale, 4],
      [fresh, 1],
    ] as const) {
      hash(d, 'aa11', 0);
      age(d, h);
    }
    expect(whole().map((x) => x.path)).toEqual([root(stale)]);
    expect(remove(whole()[0] as Candidate, { repo })).toBe('');
    expect(existsSync(root(stale))).toBe(false);
    expect(existsSync(root(fresh))).toBe(true);
  });

  it('the newest file decides, not the directory', () => {
    const w = addWorktree('vc-newfile', { fresh: true });
    hash(w, 'aa11', 0);
    age(w, 4);
    writeFileSync(join(root(w), 'aa11', 'new.js'), 'y');
    expect(whole()).toEqual([]);
  });

  it('never a candidate for the main checkout or -land, however old', () => {
    const land = `${repo}-land`;
    git(repo, 'worktree', 'add', '-q', '--detach', land, 'main');
    for (const d of [repo, land]) {
      hash(d, 'aa11', 0);
      age(d, 48);
    }
    expect(whole()).toEqual([]);
    expect(found()).toEqual([]);
  });

  it('a worktree whose branch is merged into main loses its cache even when fresh', () => {
    const w = addWorktree('vc-merged'); // commits of its own, fast-forwarded into main
    hash(w, 'aa11', 0);
    expect(whole().map((x) => x.path)).toEqual([root(w)]);
  });

  it('applyAll prints the MB freed', () => {
    const w = addWorktree('vc-freed', { fresh: true });
    hash(w, 'aa11', 0);
    age(w, 4);
    const lines: string[] = [];
    expect(applyAll(whole(), repo, (l) => lines.push(l))).toBe(0);
    expect(lines.some((l) => /vitest module cache freed: \d+ MB/.test(l))).toBe(true);
  });

  it('a fresh branch still at its fork point keeps a fresh cache', () => {
    const w = addWorktree('vc-forkpoint', { fresh: true });
    hash(w, 'aa11', 0);
    expect(whole()).toEqual([]);
  });
});
