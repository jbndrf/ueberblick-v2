import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXCLUDE } from './link-node-modules.mjs';

// WP-932: vitest keeps transformed modules between runs, per worktree, and per dependency set.
const root = fileURLToPath(new URL('../..', import.meta.url));
const config = readFileSync(join(root, 'vitest.config.ts'), 'utf8');

describe('vitest module cache (WP-932)', () => {
  it('is on, under node_modules/.cache, in a directory named by the lockfile hash', () => {
    // WP-993: switched on by fsModuleCacheOn (every checkout, off below 8 GB free)
    expect(config).toContain("import { fsModuleCacheOn, lockHash } from './scripts/ops/vitest-cache.mjs'");
    expect(config).toContain('const fsCache = fsModuleCacheOn(root);');
    expect(config).toContain('fsModuleCache: fsCache,');
    expect(config).toContain(
      '...(fsCache ? { fsModuleCachePath: `node_modules/.cache/vitest-modules/${lockDir}` } : {}),',
    );
    expect(config).toContain("const lockDir = lockHash(root) ?? 'no-lockfile';");
  });

  it('is never shared between worktrees: link-node-modules does not link .cache', () => {
    expect(EXCLUDE.has('.cache')).toBe(true);
  });
});
