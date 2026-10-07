import { describe, expect, it } from 'vitest';
import { classifyAll, landDates, parseWp, reportRow, dayReport, CLASSES } from './rework.mjs';

const wp = (id: string, fm: string, goal = 'Build it.') => ({
  id,
  text: `---\nid: ${id}\nstatus: done\n${fm}\n---\n\n## Goal\n${goal}\n\n## Log\n`,
});
const one = (id: string, fm: string, goal?: string, extra: ReturnType<typeof wp>[] = []) =>
  classifyAll([wp(id, fm, goal), ...extra]).find((r) => r.id === id) ?? fail(id);
const fail = (id: string): never => {
  throw new Error(`${id} not classified`);
};
const owns = (...o: string[]) => `owns:\n${o.map((x) => `  - ${x}`).join('\n')}`;

describe('classify', () => {
  it('new: builds something users see', () => {
    const r = one('WP-300', `title: Projekte page\n${owns('apps/web/src/routes/**')}`);
    expect(r.class).toBe('new');
    expect(r.rule).toMatch(/default/);
  });
  it('fix: title words', () => {
    const r = one('WP-301', `title: Timers surface unusable\n${owns('packages/server/**')}`);
    expect([r.class, r.rule]).toEqual(['fix', 'title: fix word']);
  });
  it('fix: hunt origin in the goal', () => {
    const r = one(
      'WP-302',
      `title: Abmelden clears the device\n${owns('apps/web/**')}`,
      'The privacy hunt of 2026-10-04 found this.',
    );
    expect([r.class, r.rule]).toEqual(['fix', 'goal: hunt or follow-up origin']);
  });
  it('fix: depends on a done WP and the goal says something broke', () => {
    const base = wp('WP-100', `title: Sync\n${owns('packages/client/**')}`);
    const r = one(
      'WP-303',
      `title: Offline images\ndepends: []\n${owns('packages/client/**')}`.replace(
        'depends: []',
        'depends:\n  - WP-100',
      ),
      'The sync worker crashes on empty queues.',
      [base],
    );
    expect(r.rule).toBe('depends on done WP + goal says something broke');
  });
  it('depends alone is not a fix', () => {
    const base = wp('WP-100', `title: Sync\n${owns('packages/client/**')}`);
    const r = one(
      'WP-304',
      `title: Queue view\ndepends:\n  - WP-100\n${owns('packages/client/**')}`,
      'Show the queue.',
      [base],
    );
    expect(r.class).toBe('new');
  });
  it('tooling: only scripts, and lane lead-c default', () => {
    expect(one('WP-310', `title: Housekeep\n${owns('scripts/ops/**', 'package.json')}`).rule).toBe(
      'owns: only tooling paths and specs',
    );
    const lane = one('WP-960', `title: Land queue\n${owns('packages/core/src/**')}`);
    expect([lane.class, lane.rule, lane.lane]).toEqual(['tooling', 'lane: lead-c', 'lead-c']);
  });
  it('test: title and only specs', () => {
    expect(one('WP-320', `title: e2e for field tools\n${owns('apps/web/src/a.ts')}`).class).toBe('test');
    expect(one('WP-321', `title: Field tools\n${owns('apps/web/e2e/field.spec.ts')}`).rule).toBe(
      'owns: only specs',
    );
  });
  it('docs: only docs', () => {
    const r = one('WP-330', `title: Owner question\n${owns('docs/research/q.md', 'work/WP-330-x.md')}`);
    expect([r.class, r.rule]).toEqual(['docs', 'owns: only docs']);
  });
  it('kind: frontmatter wins over every signal', () => {
    const r = one('WP-340', `title: Fix everything\nkind: new\n${owns('docs/x.md')}`);
    expect([r.class, r.rule]).toEqual(['new', 'kind: frontmatter']);
  });
  it('skips WPs that are not done', () => {
    const t = wp('WP-350', `title: x\n${owns('a')}`).text.replace('status: done', 'status: ready');
    expect(classifyAll([{ id: 'WP-350', text: t }])).toEqual([]);
  });
  it('every row has a known class and a rule', () => {
    for (const r of classifyAll([wp('WP-1', `title: t\n${owns('a/**')}`)])) {
      expect(CLASSES).toContain(r.class);
      expect(r.rule.length).toBeGreaterThan(0);
    }
  });
});

describe('parseWp and landDates', () => {
  it('reads lists and the goal', () => {
    const p = parseWp(
      wp('WP-1', `title: "A: b"\ndepends:\n  - WP-2\n${owns('x/** (lead-authorised)')}`).text,
    );
    expect(p.fm.depends).toEqual(['WP-2']);
    expect(p.fm.owns).toEqual(['x/**']);
    expect(p.fm.title).toBe('A: b');
    expect(p.goal).toBe('Build it.');
  });
  it('takes the earliest land date', () => {
    const d = landDates(
      '2026-10-04 chore(wp): WP-1 done (merged a)\n2026-10-02 chore(wp): WP-1 done (merged b)\n2026-10-01 other',
    );
    expect(d).toEqual({ 'WP-1': '2026-10-02' });
  });
});

describe('report row', () => {
  const rows = classifyAll(
    [
      wp('WP-1', `title: Page\n${owns('apps/**')}`),
      wp('WP-2', `title: Page two\n${owns('apps/**')}`),
      wp('WP-3', `title: Fix page\n${owns('apps/**')}`),
      wp('WP-960', `title: Land\n${owns('apps/**')}`),
      wp('WP-4', `title: Old\n${owns('apps/**')}`),
    ],
    {
      'WP-1': '2026-10-04',
      'WP-2': '2026-10-03',
      'WP-3': '2026-10-03',
      'WP-960': '2026-10-01',
      'WP-4': '2026-09-01',
    },
  );
  it('shows the 7-day shares', () => {
    expect(reportRow(rows, '2026-10-04')).toEqual([
      'landed WPs (7 days)',
      '4: new 50% · fix 25% · tooling 25% · test 0% · docs 0%',
      expect.stringContaining('metrics:rework'),
    ]);
  });
  it('says so when nothing landed', () => {
    expect(reportRow(rows, '2026-12-01')[1]).toBe('none landed');
  });
  it('per day with the lane split', () => {
    const out = dayReport(rows, '2026-10-04');
    expect(out).toContain(
      '2026-10-03 | 2 | 1 (50%) | 1 (50%) | 0 (0%) | 0 (0%) | 0 (0%) | product 2, lead-c 0',
    );
    expect(out).toContain('total | 4 |');
  });
});
