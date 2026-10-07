// Lead events are committed (work/events/<WP>.log) plus pending (<git common dir>/land-pending/<WP>.log):
// readers see the union (WP-918).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventLines, wpFlow } from './flow.mjs';
import { specEnv } from '../testing/spec-env.mjs';

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'events-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env: specEnv() });
  mkdirSync(join(repo, 'work/events'), { recursive: true });
  mkdirSync(join(repo, '.git/land-pending'), { recursive: true });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

const wpFile = (id: string) => `---\nid: ${id}\nstatus: done\nmajor: false\n---\n## Log\n`;
const LINES = [
  '2026-10-01 08:00 start',
  '2026-10-01 09:00 review 1 FAIL',
  '2026-10-01 10:00 blocked',
  '2026-10-01 11:00 unblocked',
  '2026-10-01 12:00 review 2 PASS',
  '2026-10-01 13:00 merged abc1234',
];
const flowOf = (dir: string) =>
  wpFlow(new Date('2026-09-01'), new Date('2026-11-01'), dir).map(
    ({ id, rounds, firstPass, blockedMs, cycleMs }) => ({ id, rounds, firstPass, blockedMs, cycleMs }),
  );

describe('events: committed plus pending', () => {
  it('flow numbers from a split layout equal the old all-committed layout', () => {
    writeFileSync(join(repo, 'work/WP-900-x.md'), wpFile('WP-900'));
    writeFileSync(join(repo, 'work/events/WP-900.log'), LINES.join('\n') + '\n');
    const before = flowOf(repo);
    writeFileSync(join(repo, 'work/events/WP-900.log'), LINES.slice(3).join('\n') + '\n');
    writeFileSync(join(repo, '.git/land-pending/WP-900.log'), LINES.slice(0, 3).join('\n') + '\n');
    expect(before[0]).toMatchObject({ rounds: 2, firstPass: false });
    expect(flowOf(repo)).toEqual(before);
  });

  it('eventLines returns committed lines then pending lines, and [] for none', () => {
    expect(eventLines('WP-901', repo)).toEqual([]);
    writeFileSync(join(repo, 'work/events/WP-901.log'), 'a\nb\n');
    writeFileSync(join(repo, '.git/land-pending/WP-901.log'), 'c\n');
    expect(eventLines('WP-901', repo)).toEqual(['a', 'b', 'c']);
    writeFileSync(join(repo, '.git/land-pending/WP-901.log.folding.42'), 'd\n');
    expect(eventLines('WP-901', repo)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('dedups a line present in committed and a leftover .folding (first occurrence, order kept)', () => {
    writeFileSync(
      join(repo, 'work/events/WP-902.log'),
      '2026-10-01 08:00 start\n2026-10-01 09:00 review 1 FAIL\n',
    );
    writeFileSync(
      join(repo, '.git/land-pending/WP-902.log.folding.7'),
      '2026-10-01 08:00 start\n2026-10-01 10:00 blocked\n',
    );
    writeFileSync(join(repo, '.git/land-pending/WP-902.log'), '2026-10-01 11:00 merged abc1234\n');
    expect(eventLines('WP-902', repo)).toEqual([
      '2026-10-01 08:00 start',
      '2026-10-01 09:00 review 1 FAIL',
      '2026-10-01 10:00 blocked',
      '2026-10-01 11:00 merged abc1234',
    ]);
  });
});
