import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs without declarations
import * as mw from './main-watch.mjs';

interface Failing {
  id: string;
  error: string;
}
interface Row {
  kind: string;
  sha: string;
  failing: Failing[];
}
interface Report {
  stats: { expected: number; unexpected: number };
  suites: unknown[];
}
interface Summary {
  id: string;
  passed: number;
  failed: number;
  failing: Failing[];
}
const lib = mw as {
  firstLine: (s: string) => string;
  summarizeSuite: (suite: { id: string; name: string }, report: Report | null) => Summary;
  newReds: (prev: Row | undefined, row: Row) => Failing[];
  attentionBlock: (row: Row, fresh: Failing[]) => { title: string; lines: string[] };
  decide: (a: { head: string; last?: Row; load: number; cores: number }) => { run: boolean; reason?: string };
  watch: (p: Record<string, unknown>) => Promise<{ action: string; reason?: string; row?: Row }>;
};

const f = (id: string, error = 'boom'): Failing => ({ id, error });
const row = (sha: string, failing: Failing[]): Row => ({ kind: 'main-watch', sha, failing });

describe('new-red diff', () => {
  it('does not re-alarm known reds, alarms a new one, and drops a fixed one', () => {
    const prev = row('a1', [f('tools:a.spec.ts:one'), f('participant:bundle.spec.ts:zod')]);
    expect(lib.newReds(prev, row('b2', [f('tools:a.spec.ts:one')]))).toEqual([]);
    expect(lib.newReds(prev, row('b2', [f('tools:a.spec.ts:one'), f('journeys:j.spec.ts:new')]))).toEqual([
      f('journeys:j.spec.ts:new'),
    ]);
    // the fixed red is gone from the next baseline, so it alarms again when it returns
    const fixed = row('b2', []);
    expect(lib.newReds(fixed, row('c3', [f('participant:bundle.spec.ts:zod')]))).toHaveLength(1);
  });

  it('treats every red as new when there is no previous row', () => {
    expect(lib.newReds(undefined, row('a1', [f('x'), f('y')]))).toHaveLength(2);
  });
});

describe('suite summary', () => {
  const report: Report = {
    stats: { expected: 3, unexpected: 1 },
    suites: [
      {
        specs: [
          {
            file: 'bundle.spec.ts',
            line: 7,
            title: 'no zod',
            tests: [
              {
                results: [
                  { status: 'failed', error: { message: '\u001b[31mExpected 0\u001b[39m\nReceived 1' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
  it('counts passes and keeps the first error line of each failing spec', () => {
    const s = lib.summarizeSuite({ id: 'participant', name: 'e2e/participant' }, report);
    expect(s.passed).toBe(3);
    expect(s.failed).toBe(1);
    expect(s.failing).toEqual([f('participant:bundle.spec.ts:7:no zod', 'Expected 0')]);
  });
  it('a missing report is one failure', () => {
    const s = lib.summarizeSuite({ id: 'a11y', name: 'e2e/a11y' }, null);
    expect(s.failed).toBe(1);
    expect(s.failing[0]?.id).toBe('a11y:(no report)');
  });
  it('firstLine skips blank lines and colour codes', () => {
    expect(lib.firstLine('\n  \n\u001b[1mhello\u001b[0m\nsecond')).toBe('hello');
  });
});

describe('skips', () => {
  it('skips when main has not moved since the last run', () => {
    expect(lib.decide({ head: 'a1', last: row('a1', []), load: 0.1, cores: 4 })).toEqual({
      run: false,
      reason: 'main unmoved at a1',
    });
  });
  it('skips when the 1-minute load is above the core count', () => {
    const d = lib.decide({ head: 'b2', last: row('a1', []), load: 5.5, cores: 4 });
    expect(d.run).toBe(false);
    expect(d.reason).toContain('load 5.5');
  });
  it('runs otherwise', () => {
    expect(lib.decide({ head: 'b2', last: row('a1', []), load: 4, cores: 4 }).run).toBe(true);
    expect(lib.decide({ head: 'b2', load: 0, cores: 1 }).run).toBe(true);
  });
});

describe('ATTENTION block', () => {
  it('names the sha and at most 10 new specs with their first error line', () => {
    const fresh = Array.from({ length: 12 }, (_, i) => f(`s:${i}.spec.ts:1:t`, `err ${i}`));
    const b = lib.attentionBlock(row('abcdef1234', fresh), fresh);
    expect(b.title).toBe('e2e red on main abcdef1');
    expect(b.lines).toHaveLength(11);
    expect(b.lines[0]).toBe('s:0.spec.ts:1:t: err 0');
    expect(b.lines[10]).toBe('and 2 more (metrics/raw/e2e.jsonl)');
  });
});

describe('watch (stubbed run)', () => {
  const run = (failing: Failing[]) => async () => ({
    suites: [{ id: 'apps-web', name: 'apps/web', passed: 1, failed: failing.length, failing }],
    exit: failing.length ? 1 : 0,
  });
  const make = (rows: Row[], head: string, load: number, failing: Failing[]) => {
    const appended: unknown[] = [];
    const alarms: { title: string; lines: string[] }[] = [];
    const logs: string[] = [];
    let t = 1000;
    return {
      appended,
      alarms,
      logs,
      params: {
        head,
        rows,
        load,
        cores: 4,
        runE2e: run(failing),
        now: () => (t += 500),
        append: (e: unknown) => appended.push(e),
        attention: (title: string, lines: string[]) => alarms.push({ title, lines }),
        log: (m: string) => logs.push(m),
      },
    };
  };

  it('logs both skips and writes nothing', async () => {
    const a = make([row('a1', [])], 'a1', 0, []);
    expect((await lib.watch(a.params)).action).toBe('skip');
    const b = make([row('a1', [])], 'b2', 9, []);
    expect((await lib.watch(b.params)).action).toBe('skip');
    expect(a.logs[0]).toContain('unmoved');
    expect(b.logs[0]).toContain('load');
    expect(a.appended.length + b.appended.length).toBe(0);
  });

  it('appends a row with suites and wall time, and alarms only on new reds', async () => {
    const known = row('a1', [f('apps-web:x.spec.ts:1:t')]);
    const g = make([known], 'b2', 0, [f('apps-web:x.spec.ts:1:t'), f('apps-web:y.spec.ts:2:u', 'bad')]);
    const r = await lib.watch(g.params);
    expect(r.action).toBe('ran');
    expect(g.appended).toHaveLength(1);
    expect(g.appended[0]).toMatchObject({ kind: 'main-watch', sha: 'b2', failed: 2, ms: 500 });
    expect(g.alarms).toEqual([{ title: 'e2e red on main b2', lines: ['apps-web:y.spec.ts:2:u: bad'] }]);
    const quiet = make([known], 'b2', 0, [f('apps-web:x.spec.ts:1:t')]);
    await lib.watch(quiet.params);
    expect(quiet.alarms).toEqual([]);
  });
});

describe('wiring', () => {
  it('npm run e2e:main and the units exist; the timer is every 5 hours at an off-minute', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['e2e:main']).toBe('node scripts/e2e/main-watch.mjs');
    expect(readFileSync(join(__dirname, 'e2e-main.timer'), 'utf8')).toMatch(
      /OnCalendar=\*-\*-\* 00\/5:17:00/,
    );
    expect(readFileSync(join(__dirname, 'e2e-main.service'), 'utf8')).toContain('npm run -s e2e:main');
  });
});
