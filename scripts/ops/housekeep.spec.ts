import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addWorktree,
  ageWorktree,
  git,
  HOUR,
  old,
  paths,
  realPath,
  run,
  setupEnv,
  teardownEnv,
} from './housekeep.fixture';
import { isProtected, memory, ramAdvice, remove, type Candidate } from './housekeep.mjs';
import { specEnv } from '../testing/spec-env.mjs';

let base: string;
let repo: string;
let tmp: string;
// A fresh repo per test and per repeat: a failing or repeated test must not see what another left behind.
beforeEach(() => {
  ({ base, repo, tmp } = setupEnv());
});
afterEach(teardownEnv);

/** Everything on disk and in git that a dry run must leave alone. */
const snapshot = () =>
  execFileSync('find', [base, '-not', '-path', '*/.git/*'], { encoding: 'utf8', env: specEnv() }) +
  git(repo, 'branch', '--list') +
  git(repo, 'worktree', 'list', '--porcelain');

describe('housekeep candidates', () => {
  it('finds leaked build dirs: 21 chars, only client/ssr, older than 10 minutes', () => {
    const leak = join(tmp, 'abcdefghij0123456789A');
    mkdirSync(join(leak, 'client'), { recursive: true });
    mkdirSync(join(leak, 'ssr'));
    writeFileSync(join(leak, 'client', 'x.js'), 'x'.repeat(2048));
    old(leak, 20 * 60_000);
    const young = join(tmp, 'youngyoungyoungyoungy');
    mkdirSync(join(young, 'client'), { recursive: true });
    const extra = join(tmp, 'extraextraextraextra1');
    mkdirSync(join(extra, 'client'), { recursive: true });
    mkdirSync(join(extra, 'src'));
    old(extra, HOUR);
    const wrongLength = join(tmp, 'shortname');
    mkdirSync(join(wrongLength, 'client'), { recursive: true });
    old(wrongLength, HOUR);
    const { candidates } = run();
    expect(candidates.filter((c) => c.kind === 'tmp').map((c) => c.path)).toEqual([leak]);
    expect(candidates[0]?.kb).toBeGreaterThan(0);
    rmSync(tmp, { recursive: true });
    mkdirSync(tmp);
  });

  it('finds worktrees of merged branches and of detached merged HEADs', () => {
    const a = addWorktree('merged-a');
    const b = addWorktree('detached-ok', { detach: true });
    const { candidates } = run();
    expect(paths(candidates.filter((c) => c.kind === 'worktree'))).toEqual(
      [a, b].map((p) => realPath(p)).sort(),
    );
    git(repo, 'worktree', 'remove', a);
    git(repo, 'worktree', 'remove', b);
  });

  it('finds merged docsync/* and worktree-agent-* branches, not others, not main', () => {
    for (const b of ['docsync/aaa', 'worktree-agent-1', 'feature/x']) git(repo, 'branch', b, 'main');
    git(repo, 'checkout', '-q', '-b', 'docsync/unmerged');
    writeFileSync(join(repo, 'u.txt'), 'u');
    git(repo, 'add', 'u.txt');
    git(repo, 'commit', '-q', '-m', 'u');
    git(repo, 'checkout', '-q', 'main');
    const { candidates } = run();
    expect(paths(candidates.filter((c) => c.kind === 'branch'))).toEqual(['docsync/aaa', 'worktree-agent-1']);
    git(repo, 'branch', '-D', 'docsync/aaa', 'worktree-agent-1', 'feature/x', 'docsync/unmerged');
  });

  it('finds logwatch reports older than 7 days, and only .md', () => {
    const dir = join(repo, 'metrics', 'raw', 'logwatch');
    for (const [n, days] of [
      ['old.md', 8],
      ['new.md', 1],
      ['old.jsonl', 30],
      ['old.txt', 30],
    ] as const) {
      writeFileSync(join(dir, n), 'x');
      old(join(dir, n), days * 24 * HOUR);
    }
    const { candidates } = run();
    expect(candidates.filter((c) => c.kind === 'log').map((c) => c.path)).toEqual([join(dir, 'old.md')]);
    readdirSync(dir).forEach((n) => rmSync(join(dir, n)));
  });

  it('lists candidates in the owner order: tmp, worktrees, branches, logs', () => {
    const leak = join(tmp, 'orderorderorderorder1');
    mkdirSync(join(leak, 'ssr'), { recursive: true });
    old(leak, HOUR);
    const w = addWorktree('order', { branch: 'worktree-agent-order' });
    git(repo, 'branch', 'docsync/order', 'main');
    const log = join(repo, 'metrics', 'raw', 'logwatch', 'o.md');
    writeFileSync(log, 'x');
    old(log, 9 * 24 * HOUR);
    const kinds = run().candidates.map((c) => c.kind);
    // the checked-out branch goes with its worktree, so it is a candidate too
    expect(kinds).toEqual(['tmp', 'worktree', 'branch', 'branch', 'log']);
    git(repo, 'worktree', 'remove', w);
    git(repo, 'branch', '-D', 'docsync/order', 'worktree-agent-order');
    rmSync(leak, { recursive: true });
    rmSync(log);
  });
});

describe('housekeep never deletes what it must keep', () => {
  it('keeps a dirty worktree, an unmerged one and a young one', () => {
    const dirty = addWorktree('dirty');
    writeFileSync(join(dirty, 'wip.txt'), 'uncommitted');
    const unmerged = addWorktree('unmerged', { merged: false });
    const young = addWorktree('young');
    ageWorktree(young, 60_000);
    const detachedUnmerged = addWorktree('det-unmerged', { detach: true });
    writeFileSync(join(detachedUnmerged, 'x'), 'x');
    git(detachedUnmerged, 'add', 'x');
    git(detachedUnmerged, 'commit', '-q', '-m', 'x');
    ageWorktree(detachedUnmerged, 3 * HOUR);
    const { candidates, skipped } = run();
    expect(candidates).toEqual([]);
    expect(skipped.map((s) => s.reason.replace(/ \(.*\)$/, '')).sort()).toEqual([
      'active in the last 2 h',
      'detached HEAD is not merged into main',
      'uncommitted work',
      'wp/unmerged is not merged into main',
    ]);
    for (const d of [dirty, unmerged, young, detachedUnmerged]) git(repo, 'worktree', 'remove', '--force', d);
  });

  it('keeps a worktree locked by a live pid, and removes one locked by a dead pid', () => {
    const live = addWorktree('live');
    git(repo, 'worktree', 'lock', '--reason', `claude agent (pid ${process.pid})`, live);
    const dead = addWorktree('dead');
    const gone = spawnSync('node', ['-e', '0'], { env: specEnv() }).pid; // a finished child: its pid is free
    git(repo, 'worktree', 'lock', '--reason', `claude agent (pid ${gone})`, dead);
    const noPid = addWorktree('nopid');
    git(repo, 'worktree', 'lock', '--reason', 'manual', noPid);
    const { candidates, skipped } = run();
    expect(paths(candidates)).toEqual([realPath(dead)]);
    expect(candidates[0]?.unlock).toBe(true);
    expect(skipped.map((s) => s.reason.replace(/^(active in the last 2 h) \(.*\)$/, '$1')).sort()).toEqual([
      `locked by live pid ${process.pid}`,
      'locked, no pid in the reason',
    ]);
    // apply removes the dead-locked one without --force, keeps the others
    expect(remove(candidates[0] as Candidate, { repo })).toBe('');
    expect(existsSync(dead)).toBe(false);
    expect(existsSync(live) && existsSync(noPid)).toBe(true);
    for (const d of [live, noPid]) {
      git(repo, 'worktree', 'unlock', d);
      git(repo, 'worktree', 'remove', d);
    }
  });

  it('keeps a worktree a live process works in, and the one the command runs from', () => {
    const busy = addWorktree('busy');
    expect(run({ procCwds: () => [join(realPath(busy), 'sub')] }).candidates).toEqual([]);
    expect(run({ cwd: busy }).candidates).toEqual([]);
    git(repo, 'worktree', 'remove', busy);
  });

  it('never proposes protected paths, even when a pattern matches', () => {
    expect(isProtected(join(repo, 'reference', 'a.md'), repo)).toBe(true);
    expect(isProtected(join(repo, 'metrics', 'raw', 'tests.jsonl'), repo)).toBe(true);
    expect(isProtected(join(repo, 'metrics', 'raw', 'ATTENTION.md'), repo)).toBe(true);
    expect(isProtected(join(repo, 'x', 'node_modules', 'p'), repo)).toBe(true);
    expect(isProtected(join(repo, 'metrics', 'raw', 'logwatch', 'a.md'), repo)).toBe(false);
    // an old .md inside reference/ matches the log pattern but is protected
    const inRef = join(repo, 'reference', 'old.md');
    writeFileSync(inRef, 'x');
    old(inRef, 30 * 24 * HOUR);
    const { candidates } = run({ logDir: join(repo, 'reference') });
    expect(candidates).toEqual([]);
    // a leaked-build-dir look-alike that is a symlink is not followed
    const target = join(base, 'precious');
    mkdirSync(join(target, 'client'), { recursive: true });
    symlinkSync(target, join(tmp, 'linklinklinklinklink1'));
    expect(run().candidates).toEqual([]);
    expect(existsSync(join(target, 'client'))).toBe(true);
    rmSync(join(tmp, 'linklinklinklinklink1'));
  });
});

describe('housekeep landed worktrees with a harness lock (WP-148)', () => {
  const harness = `claude agent agent-x (pid ${process.pid})`;
  /** A worktree on wp/<id>; `landed` writes the `merged` event into the repo's work/events. */
  const landedWt = (
    id: string,
    o: { lock?: string; landed?: boolean; ageMs?: number; merged?: boolean; fresh?: boolean } = {},
  ) => {
    const dir = addWorktree(id, o.merged === false ? { merged: false } : o.fresh ? { fresh: true } : {});
    if (o.landed !== false) {
      mkdirSync(join(repo, 'work', 'events'), { recursive: true });
      writeFileSync(join(repo, 'work', 'events', `${id}.log`), '2026-09-30 10:00 merged abc1234\n');
    }
    if (o.lock) git(repo, 'worktree', 'lock', '--reason', o.lock, dir);
    ageWorktree(dir, o.ageMs ?? 3 * HOUR);
    return dir;
  };
  const cleanup = (...dirs: string[]) => {
    for (const d of dirs) {
      try {
        git(repo, 'worktree', 'unlock', d);
      } catch {
        /* not locked */
      }
      git(repo, 'worktree', 'remove', '--force', d);
    }
    rmSync(join(repo, 'work'), { recursive: true, force: true });
  };

  it('lists a landed, clean, inactive worktree held by a live harness pid, marked for unlock', () => {
    const w = landedWt('WP-901', { lock: harness });
    const { candidates } = run();
    expect(paths(candidates)).toEqual([realPath(w)]);
    expect(candidates[0]?.unlock).toBe(true);
    expect(remove(candidates[0] as Candidate, { repo })).toBe('');
    expect(existsSync(w)).toBe(false);
    cleanup();
  });

  it('keeps an unlanded one, a dirty one, a recently active one and a non-harness lock', () => {
    const unlanded = landedWt('WP-902', { lock: harness, landed: false });
    const dirty = landedWt('WP-903', { lock: harness });
    writeFileSync(join(dirty, 'wip.txt'), 'x');
    old(dirty, 3 * HOUR);
    const recent = landedWt('WP-904', { lock: harness, ageMs: HOUR });
    const manual = landedWt('WP-905', { lock: `manual (pid ${process.pid})` });
    const reverted = landedWt('WP-906', { lock: harness });
    writeFileSync(
      join(repo, 'work', 'events', 'WP-906.log'),
      '2026-09-30 10:00 merged abc1234\n2026-09-30 10:05 reverted check\n',
    );
    const { candidates, skipped } = run();
    expect(candidates).toEqual([]);
    expect(skipped.map((s) => s.reason.replace(/^(active in the last 2 h) \(.*\)$/, '$1')).sort()).toEqual(
      [
        `locked by live pid ${process.pid}`,
        `locked by live pid ${process.pid}`,
        'uncommitted work',
        'active in the last 2 h',
        `locked by live pid ${process.pid}`,
      ].sort(),
    );
    cleanup(unlanded, dirty, recent, manual, reverted);
  });

  it('keeps a landed, harness-locked worktree while its index, reflog or a file is recent', () => {
    const w = landedWt('WP-910', { lock: harness });
    const gitdir = git(w, 'rev-parse', '--absolute-git-dir').trim();
    old(join(gitdir, 'index'), 10 * 60_000);
    expect(run().skipped.map((x) => x.reason)).toEqual(['active in the last 2 h (index touched)']);
    old(join(gitdir, 'index'), 3 * HOUR);
    old(join(gitdir, 'logs', 'HEAD'), 10 * 60_000);
    expect(run().skipped.map((x) => x.reason)).toEqual(['active in the last 2 h (HEAD reflog written)']);
    old(join(gitdir, 'logs', 'HEAD'), 3 * HOUR);
    old(join(w, 'WP-910.txt'), 10 * 60_000);
    expect(run().skipped.map((x) => x.reason)).toEqual(['active in the last 2 h (a file changed)']);
    old(join(w, 'WP-910.txt'), 3 * HOUR);
    expect(paths(run().candidates)).toEqual([realPath(w)]);
    cleanup(w);
  });

  it('never proposes a branch whose last event is reverted or refused', () => {
    const a = landedWt('WP-911', { fresh: true });
    const b = landedWt('WP-912', { fresh: true });
    expect(paths(run().candidates)).toEqual([realPath(a), realPath(b)].sort());
    writeFileSync(join(repo, 'work', 'events', 'WP-911.log'), 'x merged a1\nx reverted check\n');
    writeFileSync(join(repo, 'work', 'events', 'WP-912.log'), 'x merged a1\nx refused check\n');
    const r = run();
    expect(r.candidates).toEqual([]);
    expect(r.skipped.map((x) => x.reason).sort()).toEqual([
      'wp/WP-911 has no commits of its own yet',
      'wp/WP-912 has no commits of its own yet',
    ]);
    cleanup(a, b);
  });

  it('puts the harness lock back, with the same text, when the removal fails after the unlock', () => {
    const w = landedWt('WP-908', { lock: harness });
    const { candidates } = run();
    expect(paths(candidates)).toEqual([realPath(w)]);
    writeFileSync(join(w, 'late.txt'), 'x'); // dirty after planning: git refuses to remove it
    const err = remove(candidates[0] as Candidate, { repo });
    expect(err).toContain('lock restored');
    expect(existsSync(w)).toBe(true);
    expect(git(repo, 'worktree', 'list', '--porcelain')).toContain(`locked ${harness}`);
    cleanup(w);
  });

  it('keeps a landed worktree whose branch has commits main does not have', () => {
    const w = landedWt('WP-907', { lock: harness, merged: false });
    expect(run().candidates).toEqual([]);
    cleanup(w);
  });
});

describe('housekeep apply', () => {
  it('dry run deletes nothing; apply deletes exactly the candidates', () => {
    const leak = join(tmp, 'applyapplyapplyapply1');
    mkdirSync(join(leak, 'client'), { recursive: true });
    old(leak, HOUR);
    const gone = addWorktree('gone', { branch: 'worktree-agent-gone' });
    const kept = addWorktree('kept', { merged: false });
    const dirty = addWorktree('dirty2');
    writeFileSync(join(dirty, 'wip'), 'x');
    git(repo, 'branch', 'docsync/merged', 'main');
    git(repo, 'branch', 'docsync/open', 'main');
    writeFileSync(join(repo, 'x'), 'x'); // unmerged: docsync/open gets a commit main lacks
    git(repo, 'checkout', '-q', 'docsync/open');
    git(repo, 'add', 'x');
    git(repo, 'commit', '-q', '-m', 'x');
    git(repo, 'checkout', '-q', 'main');
    const log = join(repo, 'metrics', 'raw', 'logwatch', 'a.md');
    writeFileSync(log, 'x');
    old(log, 9 * 24 * HOUR);
    const jsonl = join(repo, 'metrics', 'raw', 'runs.jsonl');
    writeFileSync(jsonl, '{}');
    old(jsonl, 90 * 24 * HOUR);

    const before = snapshot();
    const { candidates } = run();
    expect(snapshot()).toBe(before); // planning is a dry run
    expect(candidates.map((c) => c.kind)).toEqual(['tmp', 'worktree', 'branch', 'branch', 'log']);

    for (const c of candidates) expect(remove(c, { repo })).toBe('');
    expect(existsSync(leak) || existsSync(gone) || existsSync(log)).toBe(false);
    expect(
      existsSync(kept) &&
        existsSync(dirty) &&
        existsSync(jsonl) &&
        existsSync(join(repo, 'reference', 'v3.md')),
    ).toBe(true);
    const branches = git(repo, 'branch', '--list', '--format=%(refname:short)').split('\n');
    expect(branches).not.toContain('docsync/merged');
    expect(branches).not.toContain('worktree-agent-gone');
    expect(branches).toContain('docsync/open');
    expect(run().candidates).toEqual([]); // idempotent
    for (const d of [kept, dirty]) git(repo, 'worktree', 'remove', '--force', d);
  });

  it('the CLI refuses --force and is a dry run without --apply', () => {
    const script = join(process.cwd(), 'scripts', 'ops', 'housekeep.mjs');
    const r = spawnSync('node', [script, '--force'], { cwd: repo, encoding: 'utf8', env: specEnv() });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('never forces');
    const d = spawnSync('node', [script], {
      cwd: repo,
      encoding: 'utf8',
      env: specEnv({ TMPDIR: tmp }),
    });
    expect(d.stdout).toContain('mode: dry run');
    expect(d.stdout).toMatch(/before: disk/);
    expect(d.stdout).not.toMatch(/after: disk/);
  });
});

describe('housekeep RAM advice', () => {
  const m = (availMb: number, swapUsedMb = 0, some = 0) => ({
    memTotalMb: 62_776,
    availMb,
    swapTotalMb: 1024,
    swapUsedMb,
    pressure: { some },
  });
  it('follows the owner rules', () => {
    expect(ramAdvice(m(40_000))).toMatch(/up to 8/);
    expect(ramAdvice(m(12_000))).toMatch(/at most 4/);
    expect(ramAdvice(m(6_000))).toMatch(/dispatch nothing.*available 6 GB < 8 GB/);
  });
  it('idle swap with plenty of memory never stops dispatch (2026-10-03)', () => {
    const line = ramAdvice(m(46_462, 800));
    expect(line).not.toMatch(/dispatch nothing/);
    expect(line).toMatch(/up to 8/);
  });
  it('swap over half used while memory is short stops dispatch and names the reason', () => {
    expect(ramAdvice(m(12_000, 800, 3.2))).toMatch(/dispatch nothing.*PSI 3.2/);
    expect(ramAdvice(m(12_000, 100, 3.2))).not.toMatch(/dispatch nothing/);
  });
  it('reads /proc/meminfo text', () => {
    const t =
      'MemTotal: 4194304 kB\nMemAvailable:   2097152 kB\nSwapTotal:  1048576 kB\nSwapFree:  524288 kB\n';
    expect(memory(t, { some: 0 })).toMatchObject({ availMb: 2048, swapUsedMb: 512, memTotalMb: 4096 });
  });
});
