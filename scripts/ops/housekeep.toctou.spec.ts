import { existsSync, mkdirSync, renameSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run, setupEnv, teardownEnv } from './housekeep.fixture';
import { REMOVE_HINT, remove, type Candidate } from './housekeep.mjs';

let base: string;
let repo: string;
let tmp: string;
beforeEach(() => {
  ({ base, repo, tmp } = setupEnv());
});
afterEach(teardownEnv);

const outside = () => join(base, 'outside');
const asCandidate = (c: unknown) => c as Candidate;

describe('housekeep apply re-checks the path (TOCTOU)', () => {
  it('vitest-cache: vitest-modules swapped for a symlink after planning is refused', () => {
    const root = join(repo, 'node_modules', '.cache', 'vitest-modules');
    for (const n of ['a1', 'b2', 'c3', 'd4']) mkdirSync(join(root, n), { recursive: true });
    for (const n of ['a1', 'b2', 'c3', 'd4']) mkdirSync(join(outside(), n), { recursive: true });
    writeFileSync(join(repo, 'package-lock.json'), '{}'); // WP-999: the current lockfile hash is the one kept
    const planned = run().candidates.filter((c) => c.kind === 'vitest-cache');
    expect(planned.length).toBe(4);
    renameSync(root, `${root}.moved`);
    symlinkSync(outside(), root);
    for (const c of planned) {
      expect(remove(asCandidate(c), { repo })).toContain('no longer a plain directory');
    }
    for (const n of ['a1', 'b2', 'c3', 'd4']) expect(existsSync(join(outside(), n))).toBe(true);
  });

  it('cache: node-compile-cache swapped for a symlink after planning is refused', () => {
    const cache = join(tmp, 'node-compile-cache');
    mkdirSync(cache);
    writeFileSync(join(cache, 'blob'), '');
    truncateSync(join(cache, 'blob'), 201 * 1024 * 1024);
    const planned = run().candidates.filter((c) => c.kind === 'cache');
    expect(planned.length).toBe(1);
    mkdirSync(outside());
    writeFileSync(join(outside(), 'keep'), 'x');
    renameSync(cache, `${cache}.moved`);
    symlinkSync(outside(), cache);
    expect(remove(asCandidate(planned[0]), { repo })).toContain('no longer a plain directory');
    expect(existsSync(join(outside(), 'keep'))).toBe(true);
  });

  it('prints a per-kind manual hint', () => {
    const at = (kind: string) =>
      REMOVE_HINT[kind]?.({ kind, path: '/p', branch: 'b' } as unknown as Candidate);
    expect(at('cache')).toBe('rm -rf /p');
    expect(at('vitest-cache')).toBe('rm -rf /p');
    expect(at('copy')).toBe('cd /p && node scripts/ops/link-node-modules.mjs');
    expect(at('branch')).toBe('git branch -d b');
  });
});
