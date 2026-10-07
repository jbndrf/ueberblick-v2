import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fsModuleCacheOn } from './vitest-cache.mjs';

// WP-993: the fs module cache runs in every checkout while the disk has room (WP-973 had limited it to main and -land).
const base = mkdtempSync(join(tmpdir(), 'vitest-cache-'));
function checkout(name: string, gitIsDir: boolean): string {
  const dir = join(base, name);
  mkdirSync(dir, { recursive: true });
  if (gitIsDir) mkdirSync(join(dir, '.git'));
  else writeFileSync(join(dir, '.git'), 'gitdir: /elsewhere\n');
  return dir;
}
const main = checkout('ueberblick-v4', true);
const land = checkout('ueberblick-v4-land', false);
const agent = checkout('ueberblick-v4/.claude/worktrees/agent-x', false);
const docsync = checkout('ueberblick-v4-docsync-abc', false);
const lead = checkout('ueberblick-v4-lead-a', false);

const GB = 1024 ** 3;
const free = (gb: number) => () => gb * GB;

describe('fsModuleCacheOn (WP-993)', () => {
  it('is on for every checkout kind with 20 GB free', () => {
    for (const d of [main, land, agent, docsync, lead]) expect(fsModuleCacheOn(d, {}, free(20))).toBe(true);
  });
  it('is off with 5 GB free, on at exactly 8 GB', () => {
    for (const d of [main, agent]) expect(fsModuleCacheOn(d, {}, free(5))).toBe(false);
    expect(fsModuleCacheOn(agent, {}, free(8))).toBe(true);
  });
  it('is off when the free space cannot be read', () => {
    expect(fsModuleCacheOn(agent, {}, () => Number.NaN)).toBe(false);
    expect(
      fsModuleCacheOn(agent, {}, () => {
        throw new Error('no statfs');
      }),
    ).toBe(false);
  });
  it('UEB_VITEST_FS_CACHE overrides both ways, whatever the disk says', () => {
    expect(fsModuleCacheOn(agent, { UEB_VITEST_FS_CACHE: '0' }, free(20))).toBe(false);
    expect(fsModuleCacheOn(agent, { UEB_VITEST_FS_CACHE: '1' }, free(5))).toBe(true);
    expect(fsModuleCacheOn(main, { UEB_VITEST_FS_CACHE: '0' }, free(20))).toBe(false);
  });
  it('reads the real disk by default', () => {
    expect(typeof fsModuleCacheOn(agent, {})).toBe('boolean');
  });
});
