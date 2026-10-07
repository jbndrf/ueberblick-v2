// isLanded reads committed plus pending events (WP-918).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupEnv, teardownEnv } from './housekeep.fixture';
import { isLanded } from './housekeep.mjs';

let repo: string;
beforeAll(() => {
  ({ repo } = setupEnv());
  mkdirSync(join(repo, 'work', 'events'), { recursive: true });
  mkdirSync(join(repo, '.git', 'land-pending'), { recursive: true });
});
afterAll(teardownEnv);
beforeEach(() => {
  for (const id of ['WP-950', 'WP-951']) {
    rmSync(join(repo, 'work/events', `${id}.log`), { force: true });
    rmSync(join(repo, '.git/land-pending', `${id}.log`), { force: true });
  }
});

describe('isLanded with pending events (WP-918)', () => {
  it('committed merged + pending refused: not landed', () => {
    writeFileSync(join(repo, 'work/events/WP-950.log'), '2026-09-30 10:00 merged abc1234\n');
    expect(isLanded(repo, 'wp/WP-950')).toBe(true);
    writeFileSync(join(repo, '.git/land-pending/WP-950.log'), '2026-09-30 11:00 refused check\n');
    expect(isLanded(repo, 'wp/WP-950')).toBe(false);
  });

  it('a pending start after merged does not un-land it', () => {
    writeFileSync(join(repo, 'work/events/WP-951.log'), '2026-09-30 10:00 merged abc1234\n');
    writeFileSync(join(repo, '.git/land-pending/WP-951.log'), '2026-09-30 11:00 start\n');
    expect(isLanded(repo, 'wp/WP-951')).toBe(true);
  });
});
