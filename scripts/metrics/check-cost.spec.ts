import { describe, expect, it } from 'vitest';
import { checkCost, formatCheckCost, parseEvents, wpOfBranch } from './check-cost.mjs';

const H = 3_600_000;
const run = (at: string, branch: string, suite: 'check' | 'changed', wallMs: number, extra = {}) => ({
  at,
  branch,
  suite,
  parent: null as string | null,
  exitCode: 0,
  wallMs,
  ...extra,
});
// Event times are the machine's local clock; the fixture builds ISO times the same way.
const events = parseEvents(
  new Map([
    [
      'WP-1',
      '2026-10-01 10:00 start\n2026-10-01 10:30 review 1 FAIL\n2026-10-01 11:30 review 2 PASS\n2026-10-01 12:00 merged aaa\n',
    ],
    ['WP-2', '2026-10-01 10:05 start\n2026-10-01 11:00 review 1 PASS\n2026-10-01 12:00 merged bbb\n'],
    ['WP-3', '2026-09-30 10:00 start\n2026-09-30 11:00 merged ccc\n'],
  ]),
);
const iso = (hhmm: string) => new Date(`2026-10-01T${hhmm}:00`).toISOString();

describe('wpOfBranch', () => {
  it.each([
    ['wp/WP-12', 'WP-12'],
    ['wp/12', 'WP-12'],
    ['wp/WP-12.3', 'WP-12.3'],
    ['HEAD', null],
    ['lead-a', null],
  ])('%s', (b, w) => expect(wpOfBranch(b)).toBe(w));
});

describe('checkCost', () => {
  const steps = [
    run(iso('10:10'), 'wp/WP-1', 'changed', 1 * H), // initial
    run(iso('10:20'), 'wp/WP-1', 'check', 0.5 * H, { gateWaitMs: 60_000 }), // initial
    run(iso('11:00'), 'wp/WP-1', 'changed', 0.25 * H), // fix round 1
    run(iso('11:45'), 'wp/WP-1', 'check', 0.5 * H), // after PASS
    run(iso('10:50'), 'wp/WP-2', 'check', 0.5 * H),
    run(iso('11:50'), 'HEAD', 'check', 1 * H), // land staging, one train for both
    run(iso('09:00'), 'wp/WP-9', 'check', 5 * H), // WP not landed in the window
    { ...run(iso('10:15'), 'wp/WP-1', 'check', 99 * H), parent: 'check' }, // nested, ignored
    run('2026-09-30T10:00:00.000Z', 'wp/WP-3', 'check', 7 * H), // before the window
  ];
  const since = new Date('2026-10-01T00:00:00');
  const r = checkCost({ steps, tests: [], events, since });

  it('lists the WPs landed in the window only', () => {
    expect(r.rows.map((x: { wp: string }) => x.wp)).toEqual(['WP-1', 'WP-2']);
  });
  it('counts per WP by kind and phase', () => {
    const w1 = { ...r.rows[0] };
    expect(w1).toMatchObject({ full: 2, changed: 2, initial: 2, fix: 1, afterPass: 1 });
    expect(w1.fullMs).toBe(1 * H);
    expect(w1.changedMs).toBe(1.25 * H);
    expect(r.rows[1]).toMatchObject({ full: 1, changed: 0, initial: 1 });
  });
  it('counts land staging checks (HEAD) separately and in the totals', () => {
    expect(r.land).toMatchObject({ full: 1, fullMs: 1 * H });
    expect(r.totals.landed).toBe(2);
    expect(r.totals.fullChecks).toBe(5); // 2 + 1 + HEAD + the unlanded WP-9
    expect(r.totals.fullPerLanded).toBe(2.5);
    expect(r.totals.fullMs).toBe(7.5 * H);
  });
  it('sums the gate wait where present and says when none carries it', () => {
    expect(r.totals.gateWaitMs).toBe(60_000);
    const bare = steps.map((s) => ({ ...s, gateWaitMs: undefined }));
    const none = checkCost({ steps: bare, tests: [], events, since });
    expect(none.totals.gateWaitMs).toBeNull();
    expect(formatCheckCost(none)).toContain('no record carries gateWaitMs');
  });
  it('the window excludes earlier runs and WPs', () => {
    const wide = checkCost({ steps, tests: [], events, since: new Date('2026-09-01T00:00:00') });
    expect(wide.rows.map((x: { wp: string }) => x.wp)).toContain('WP-3');
    expect(wide.totals.fullMs).toBe(14.5 * H);
  });
  it('prints a table', () => {
    const t = formatCheckCost(r);
    expect(t).toContain('WP-1');
    expect(t).toContain('full checks per landed WP');
  });
});
