import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { latestBenchRows, rowCells } from './bench-rows.mjs';
import { parseWp, summarize } from './flow.mjs';
import { pct, wpOf } from './lib.mjs';

const wp = (log: string) =>
  `---\nid: WP-012\nstatus: done\nmajor: true   # comment\n---\n\n## Goal\nx\n\n## Log\n${log}\n`;

describe('metrics: work-package Log events', () => {
  it('parses the event lines and ignores prose', () => {
    const w = parseWp(
      wp(
        '2026-10-01 09:00 start\nDid the parser, surprise: none.\n- 2026-10-01 15:30 review 1 FAIL\n2026-10-02 10:00: review  2 PASS\n2026-10-02 11:00 merged 1a2b3c4',
      ),
    );
    expect(w).toMatchObject({ id: 'WP-012', status: 'done', major: true });
    expect(w.events.map((e) => e.event)).toEqual(['start', 'review 1 fail', 'review 2 pass', 'merged']);
  });

  it('computes cycle time, rounds, first pass and blocked time', () => {
    const f = summarize(
      parseWp(
        wp(
          '2026-10-01 08:00 start\n2026-10-01 09:00 blocked\n2026-10-01 11:00 unblocked\n2026-10-01 12:00 review 1 PASS\n2026-10-01 13:00 merged abc',
        ),
      ),
    );
    expect(f).toMatchObject({
      rounds: 1,
      firstPass: true,
      cycleMs: 5 * 3_600_000,
      blockedMs: 2 * 3_600_000,
      escalated: false,
    });
  });

  it('counts a failed first review as not first-pass and skips unmerged work', () => {
    expect(
      summarize(parseWp(wp('2026-10-01 review 1 FAIL\n2026-10-01 review 2 PASS\n2026-10-01 merged x')))
        ?.firstPass,
    ).toBe(false);
    expect(summarize(parseWp(wp('2026-10-01 08:00 start')))).toBeNull();
  });
});

describe('metrics: helpers', () => {
  it('percentiles and WP ids from branches', () => {
    expect(pct([5, 1, 3], 50)).toBe(3);
    expect(pct([], 50)).toBeNull();
    expect(wpOf('wp/WP-040-fold')).toBe('WP-040');
    expect(wpOf('main')).toBeNull();
  });
});

describe('metrics: split work packages', () => {
  it('keeps sub-ids like WP-020.1', () => {
    expect(wpOf('wp/WP-020.1')).toBe('WP-020.1');
  });
});

describe('metrics: red lands', () => {
  it('counts refused check|install|conflict like the older reverted events', () => {
    const w = parseWp(
      wp(
        '2026-10-01 09:00 refused check\n2026-10-01 10:00 refused install\n2026-10-01 11:00 refused conflict\n2026-10-01 13:00 merged abc',
      ),
    );
    expect(summarize(w)).toMatchObject({ reverts: 3 });
  });
});

describe('metrics: land reverts (logs written before WP-903)', () => {
  it('parses reverted check|install|conflict and counts them', () => {
    const w = parseWp(
      wp(
        '2026-10-01 08:00 start\n2026-10-01 09:00 reverted check\n2026-10-01 10:00 reverted install\n2026-10-01 11:00 reverted conflict\n2026-10-01 12:00 reverted other\n2026-10-01 13:00 merged abc',
      ),
    );
    expect(w.events.map((e) => e.event)).toEqual([
      'start',
      'reverted check',
      'reverted install',
      'reverted conflict',
      'merged',
    ]);
    expect(summarize(w)).toMatchObject({ reverts: 3 });
  });
});

describe('metrics: docs/12 rows from the latest bench result', () => {
  it('takes the newest bench JSON and shows "unmeasured" for rows without a value', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-rows-'));
    const row = (r: string, adjusted?: number) => ({
      row: r,
      limit: 100,
      unit: 'ms',
      adjusted,
      sources: 1,
      derived: 2,
    });
    writeFileSync(join(dir, '2026-01-01.json'), JSON.stringify({ rows: [row('old', 1)] }));
    writeFileSync(
      join(dir, '2026-02-01.json'),
      JSON.stringify({ rows: [row('long-task', 18.3), row('heap-60k')] }),
    );
    const latest = latestBenchRows(dir);
    expect(latest?.date).toBe('2026-02-01');
    expect(rowCells(latest?.rows ?? [])).toEqual([
      ['long-task', '18.3 ms', '100 ms', '1', '2'],
      ['heap-60k', 'unmeasured', '100 ms', '1', '2'],
    ]);
  });

  it('is null without a result', () => {
    expect(latestBenchRows(join(tmpdir(), 'no-such-bench-dir'))).toBeNull();
  });
});
