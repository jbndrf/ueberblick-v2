// Tests of the pure parts of the browser benchmark harness (WP-528). The browser run itself is
// `npm run bench:browser`. Run: npm run bench:browser:test
import { describe, expect, it } from 'vitest';
import { generateFeatures, formFixture, FIXTURE_BBOX, FREE_RADIUS, FREE_SPOT } from './lib/data';
import { judge, judgeAll, renderTable, SLOW_PARAM, type Measurement } from './lib/verdict.mjs';
import { aggregateRuns, type RunRow } from './lib/aggregate.mjs';
import { byScript } from './lib/profile.mjs';
import { missingLibs, debPackagesFor } from './lib/libs.mjs';
import { defineBudget, docBudget } from '../harness/budget.mjs';

describe('fixtures', () => {
  it('60k features are deterministic per seed and differ across seeds', () => {
    const a = generateFeatures(60_000, 1);
    const b = generateFeatures(60_000, 1);
    expect(a).toHaveLength(60_000);
    expect(a[0]).toEqual(b[0]);
    expect(a[59_999]).toEqual(b[59_999]);
    expect(generateFeatures(10, 2)[3]).not.toEqual(generateFeatures(10, 1)[3]);
  });

  it('ids are unique and anchors lie inside the fixture box', () => {
    const f = generateFeatures(5_000, 7);
    expect(new Set(f.map((x) => x.id)).size).toBe(5_000);
    for (const x of f) {
      expect(x.anchor[0]).toBeGreaterThanOrEqual(FIXTURE_BBOX[0]);
      expect(x.anchor[0]).toBeLessThanOrEqual(FIXTURE_BBOX[2]);
      expect(x.anchor[1]).toBeGreaterThanOrEqual(FIXTURE_BBOX[1]);
      expect(x.anchor[1]).toBeLessThanOrEqual(FIXTURE_BBOX[3]);
    }
  });

  it('nothing lies near the free spot (a feature moved there is a single marker)', () => {
    for (const x of generateFeatures(20_000, 4711)) {
      expect(Math.hypot(x.anchor[0] - FREE_SPOT[0], x.anchor[1] - FREE_SPOT[1])).toBeGreaterThan(
        FREE_RADIUS - 0.3,
      );
    }
  });

  it('a form fixture has the asked number of fields and matching properties', () => {
    const fx = formFixture(50);
    expect(Object.keys(fx.form)).toHaveLength(50);
    expect(Object.keys(fx.properties)).toEqual(Object.keys(fx.form));
  });
});

describe('verdict', () => {
  const budget = docBudget('interaction-to-next-paint');
  it('passes at the limit and fails above it', () => {
    const rows = judge([
      { scenario: 'form', label: 'open', budget, value: 200 },
      { scenario: 'form', label: 'keystroke', budget, value: 201 },
    ]);
    expect(rows.map((r) => r.pass)).toEqual([true, false]);
  });

  it('a NaN value fails (a scenario that measured nothing is a failure)', () => {
    expect(judge([{ scenario: 's', label: 'x', budget, value: Number.NaN }])[0]?.pass).toBe(false);
  });

  it('the renderer-init row is report-only: never fails, marked INFO; NaN still fails', () => {
    const init = defineBudget({
      id: 'map-renderer-init',
      limit: 100,
      unit: 'ms',
      derivedFrom: 'long-task: renderer init (B-007)',
      device: 'measured',
    });
    const rows = judge([
      { scenario: 'map', label: 'renderer init', budget: init, value: 900, reportOnly: true },
      { scenario: 'map', label: 'renderer init', budget: init, value: Number.NaN, reportOnly: true },
    ]);
    expect(rows.map((r) => r.pass)).toEqual([true, false]);
    expect(renderTable(rows.slice(0, 1))).toContain('INFO');
  });

  it('a normal row over its limit still fails, and report-only on any other row throws', () => {
    expect(judge([{ scenario: 'map', label: 'x', budget, value: 900 }])[0]?.pass).toBe(false);
    expect(() => judge([{ scenario: 'map', label: 'x', budget, value: 900, reportOnly: true }])).toThrow(
      /may not be report-only/,
    );
  });

  it('the table lists every row and marks failures', () => {
    const text = renderTable(judge([{ scenario: 'form', label: 'open', budget, value: 250 }]));
    expect(text).toContain('form');
    expect(text).toContain('FAIL');
    expect(SLOW_PARAM).toBe('slow');
  });
});

describe('system libraries', () => {
  const ldd = [
    '\tlibnspr4.so => not found',
    '\tlibnss3.so => not found',
    '\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x1)',
    '\tlibxkbcommon.so.0 => not found',
  ].join('\n');
  it('finds what ldd reports as missing', () => {
    expect(missingLibs(ldd)).toEqual(['libnspr4.so', 'libnss3.so', 'libxkbcommon.so.0']);
    expect(missingLibs('\tlibc.so.6 => /lib/libc.so.6 (0x1)')).toEqual([]);
  });
  it('maps them to Debian packages, and an unmapped library is an error, not a skip', () => {
    expect(debPackagesFor(['libnspr4.so', 'libnss3.so', 'libnssutil3.so'])).toEqual(['libnspr4', 'libnss3']);
    expect(() => debPackagesFor(['libmystery.so.9'])).toThrow(/libmystery/);
  });
});

describe('run aggregation (B-008)', () => {
  const budget = docBudget('long-task');
  const run = (pan: number): RunRow[] => [
    { label: 'longest task, pan/zoom', budget, value: pan },
    { label: 'longest task, pan/zoom, single-run max', budget, value: pan, aggregate: 'max', info: true },
  ];

  it('enforced rows are the median of the runs; a spike in one of three runs does not fail', () => {
    const [enforced] = aggregateRuns('map-60k', [run(0), run(886), run(40)]);
    expect(enforced?.value).toBe(40);
    expect(judge(enforced ? [enforced] : [])[0]?.pass).toBe(true);
  });

  it('the info row reports the worst single run and carries the info flag', () => {
    const [, worst] = aggregateRuns('map-60k', [run(0), run(886), run(40)]);
    expect(worst?.value).toBe(886);
    expect(worst?.info).toBe(true);
  });

  it('a median over the limit still fails, and an all-NaN row stays NaN', () => {
    const [over] = aggregateRuns('s', [run(150), run(200), run(0)]);
    expect(judge(over ? [over] : [])[0]?.pass).toBe(false);
    expect(aggregateRuns('s', [run(Number.NaN)])[0]?.value).toBeNaN();
  });
});

describe('judgeAll: info rows (B-008)', () => {
  const budget = docBudget('long-task');
  const row = (label: string, value: number, extra: Partial<Measurement> = {}): Measurement => ({
    scenario: 'map-60k',
    label,
    budget,
    value,
    ...extra,
  });
  const enforced = row('pan/zoom', 40, { aggregate: 'median' });
  const max = row('pan/zoom max', 886, { aggregate: 'max', info: true });

  it('an info row with no enforced twin throws', () => {
    expect(() => judgeAll([max])).toThrow(/no enforced median/);
    const other = row('other', 1, { aggregate: 'median', budget: docBudget('interaction-to-next-paint') });
    expect(() => judgeAll([other, max])).toThrow(/no enforced median/);
    expect(() => judgeAll([{ ...enforced, scenario: 'form' }, max])).toThrow(/no enforced median/);
  });

  it('an info row that is not aggregated as max throws', () => {
    expect(() => judgeAll([enforced, { ...max, aggregate: 'median' }])).toThrow(/must aggregate as max/);
    expect(() => judgeAll([enforced, { ...max, aggregate: undefined } as unknown as typeof max])).toThrow(
      /must aggregate as max/,
    );
  });

  it('the valid pan/zoom max row is accepted and not judged', () => {
    const { rows, info } = judgeAll([enforced, max]);
    expect(rows).toHaveLength(1);
    expect(info).toEqual([max]);
  });

  it('every non-info row goes through judge; an enforced failure still fails with info rows present', () => {
    const { rows } = judgeAll([row('pan/zoom', 150, { aggregate: 'median' }), row('ok', 10), max]);
    expect(rows.map((r) => r.pass)).toEqual([false, true]);
  });
});

describe('profile by-script totals', () => {
  const frame = (functionName: string, url = '') => ({ functionName, url, lineNumber: 0 });
  const prof = {
    nodes: [
      { id: 1, callFrame: frame('(root)'), children: [2, 5] },
      { id: 2, callFrame: frame('_render', 'http://x/maplibre-gl-abc.js'), children: [3] },
      { id: 3, callFrame: frame('draw', 'http://x/maplibre-gl-abc.js'), children: [4] },
      { id: 4, callFrame: frame('bufferData') },
      { id: 5, callFrame: frame('(idle)') },
    ],
    samples: [4, 3, 2, 5, 5],
    timeDeltas: [2000, 1000, 1000, 4000, 4000],
  };

  it('sums inclusive ms per script, counting a script once per sample', () => {
    const t = byScript(prof);
    expect(t.get('maplibre')).toBeCloseTo(4); // three samples, two frames each counted once
    expect(t.get('bufferData')).toBeCloseTo(2);
    expect(t.get('(idle)')).toBeCloseTo(8);
    expect(t.get('(root)')).toBeCloseTo(12);
  });
});
