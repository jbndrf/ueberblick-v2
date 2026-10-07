import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  e2eRunRows,
  landLatency,
  landLatencyRows,
  loadLandEvents,
  // @ts-expect-error plain .mjs without declarations
} from './wait-rows.mjs';

const now = new Date('2026-10-04T12:00:00Z');
const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
const ev = (h: number, event: string) => ({ at: at(h), event });

describe('e2eRunRows', () => {
  const run = (h: number, caller: string, mode: string, wallMs: number, extra = {}) => ({
    at: at(h).toISOString(),
    caller,
    mode,
    wallMs,
    exitCode: 0,
    ...extra,
  });
  it('is empty without runs in the last 24 h', () => {
    expect(e2eRunRows([], now)).toEqual([]);
    expect(e2eRunRows([run(30, 'agent', 'full', 1000)], now)).toEqual([]);
  });
  it('counts, sums minutes, p50/p90 and splits by caller and mode', () => {
    const rows = e2eRunRows(
      [
        run(1, 'agent', 'affected', 60_000, { gateWaitMs: 30_000 }),
        run(2, 'agent', 'affected', 120_000),
        run(3, 'train', 'affected', 300_000, { exitCode: 1, infra: true }),
        run(40, 'agent', 'full', 999_000),
      ],
      now,
    );
    expect(rows[0]?.[0]).toBe('e2e runs (24 h)');
    expect(rows[0]?.[1]).toContain('3 runs, 8.0 min total');
    expect(rows[0]?.[1]).toContain('1 red (1 infra)');
    expect(rows.map((r: string[]) => r[0])).toEqual([
      'e2e runs (24 h)',
      '  agent / affected',
      '  train / affected',
    ]);
    expect(rows[1]?.[1]).toContain('2 runs, 3.0 min total');
    expect(rows[1]?.[1]).toContain('gate wait 0.5 min');
  });
});

describe('landLatency', () => {
  const wps = [
    // clean: PASS 5 h ago, merged 4 h ago
    { id: 'WP-1', events: [ev(9, 'start'), ev(5, 'review 1 pass'), ev(4, 'merged')] },
    // refused once on the way: PASS 10 h ago, refused, merged 6 h ago; an earlier FAIL and refusal do not count
    {
      id: 'WP-2',
      events: [
        ev(20, 'review 1 fail'),
        ev(19, 'refused check'),
        ev(10, 'review 2 pass'),
        ev(8, 'refused check'),
        ev(6, 'merged'),
      ],
    },
    // no merge yet
    { id: 'WP-3', events: [ev(3, 'review 1 pass')] },
    // merged long ago: outside 7 days
    { id: 'WP-4', events: [ev(24 * 10, 'review 1 pass'), ev(24 * 10 - 1, 'merged')] },
    // merged without a review (docs): skipped
    { id: 'WP-5', events: [ev(2, 'merged')] },
  ];
  it('measures last PASS to merged, ignores old, unreviewed and unmerged WPs', () => {
    const r = landLatency(wps, now);
    const cells = r.merged.map((m: { id: string; ms: number; refused: boolean }) => [
      m.id,
      m.ms / 3_600_000,
      m.refused,
    ]);
    expect(cells).toEqual([
      ['WP-1', 1, false],
      ['WP-2', 4, true],
    ]);
    expect(r.unmerged).toBe(1);
  });
  it('the row shows p50/p90 hours, the refused share and the unmerged count', () => {
    const [row] = landLatencyRows(wps, now);
    expect(row?.[0]).toBe('land latency (7 days)');
    expect(row?.[1]).toContain('2 WPs');
    expect(row?.[1]).toContain('p90 4.0 h');
    expect(row?.[1]).toContain('refused at least once on the way 1 (50%)');
    expect(row?.[1]).toContain('1 passed review and are not merged yet');
  });
  it('is empty without merged WPs', () => {
    expect(
      landLatencyRows(
        wps.filter((w) => w.id === 'WP-3'),
        now,
      ),
    ).toEqual([]);
  });
});

describe('loadLandEvents', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wait-rows-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it('reads work/events/*.log into events', () => {
    mkdirSync(join(dir, 'work/events'), { recursive: true });
    writeFileSync(
      join(dir, 'work/events/WP-7.log'),
      '2026-10-04 04:02 start\n2026-10-04 05:26 review 2 PASS\n2026-10-04 05:38 refused check\n2026-10-04 06:08 merged f7863f797\n',
    );
    const [wp] = loadLandEvents(dir);
    expect(wp?.id).toBe('WP-7');
    expect(wp?.events.map((e: { event: string }) => e.event)).toEqual([
      'start',
      'review 2 pass',
      'refused check',
      'merged',
    ]);
  });
});
