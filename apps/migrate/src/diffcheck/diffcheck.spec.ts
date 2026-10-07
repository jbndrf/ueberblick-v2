// WP-302: recorded synthetic v3 runs replayed through the converted fixtures; report format; robustness.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convertConfig } from '../config/convert';
import { loadFixture } from '../config/testing';
import { diffcheck } from './diffcheck';
import { formatReport, summarize } from './format';
import { parseRuns, RunsError } from './runs';
import { loadRuns } from './testing';
import type { V3Run } from './types';
import { sameValue, toV4 } from './values';

const baum = convertConfig(loadFixture('baumkontrolle'));
const meldung = convertConfig(loadFixture('meldungen'));
const baumRuns = loadRuns('baumkontrolle');
const meldungRuns = loadRuns('meldungen');
const byId = (runs: readonly V3Run[], id: string): V3Run => {
  const r = runs.find((x) => x.id === id);
  if (!r) throw new Error(`no run ${id}`);
  return r;
};

describe('recorded runs on the fixtures', () => {
  it('finds no difference on a project whose recorded runs v4 reproduces', () => {
    expect(diffcheck(meldungRuns, meldung)).toEqual([]);
  });

  it('finds exactly the known differences on baumkontrolle, each with its cause', () => {
    const d = diffcheck(baumRuns, baum);
    // only the run of a task that the project does not have is left
    expect(d.map((x) => `${x.runId}:${x.kind}:${x.cause}`)).toEqual([
      'unknown-task:not_replayable:not_convertible',
    ]);
    expect(d.some((x) => x.kind === 'outcome')).toBe(false);
    expect(d.filter((x) => x.cause === 'known')).toEqual([]);
    expect(d[0]?.reason).toContain('baum/gibtsnicht');
  });

  it('reads the resulting stage and values, not only the outcome', () => {
    // a wrong recording of the stage after the run shows up as a stage difference
    const wrong: V3Run = {
      ...byId(meldungRuns, 'zurueckziehen-owner'),
      recorded: { outcome: 'accepted', stage: 'neu' },
    };
    const d = diffcheck([wrong], meldung);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: 'stage', v3: 'neu', v4: '"erledigt"' });
    const wrongValue: V3Run = {
      ...byId(meldungRuns, 'bearbeiten-ok'),
      recorded: { outcome: 'accepted', values: { prio: 'niedrig' } },
    };
    expect(diffcheck([wrongValue], meldung)[0]).toMatchObject({
      kind: 'value',
      v3: 'prio = "niedrig"',
      v4: 'prio = "hoch"',
    });
  });

  it('attaches a curated note as the cause when the run carries one, and only when v4 differs', () => {
    const noted: V3Run = {
      ...byId(meldungRuns, 'bearbeiten-ok'),
      recorded: { outcome: 'refused', known: 'v3 refused this for a reason that v4 dropped' },
    };
    const d = diffcheck([noted], meldung);
    expect(d[0]).toMatchObject({ kind: 'outcome', cause: 'known' });
    expect(d[0]?.reason).toContain('dropped');
    expect(
      diffcheck(
        [{ ...byId(meldungRuns, 'bearbeiten-ok'), recorded: { outcome: 'accepted', known: 'x' } }],
        meldung,
      ),
    ).toEqual([]);
  });

  it('is independent of the order of the runs and of earlier runs (each run is replayed alone)', () => {
    fc.assert(
      fc.property(fc.shuffledSubarray(baumRuns, { minLength: 0 }), (subset) => {
        const together = diffcheck(subset, baum);
        const alone = subset.flatMap((r) => diffcheck([r], baum));
        expect(together).toEqual(alone);
      }),
      { numRuns: Number(process.env['FC_RUNS'] ?? 40) },
    );
  });
});

describe('values', () => {
  const sel = { property: 'v', type: 'select', options: { '3': 'v3' } } as const;
  it('maps options through the conversion mapping and refuses what has no counterpart', () => {
    expect(toV4(sel, '3')).toBe('v3');
    expect(toV4(sel, '9')).toBeUndefined();
    expect(toV4({ property: 'n', type: 'number' }, '12')).toBe(12);
    expect(toV4({ property: 'n', type: 'number' }, 'abc')).toBeUndefined();
    expect(toV4({ property: 'm', type: 'multiselect', options: { a: 'oa', b: 'ob' } }, '["a","b"]')).toEqual([
      'oa',
      'ob',
    ]);
    expect(toV4({ property: 'n', type: 'number' }, '')).toBeNull();
  });
});

describe('comparing values', () => {
  it('treats an empty value, an empty text and no value as the same, and ignores list order', () => {
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue('', null)).toBe(true);
    expect(sameValue([], null)).toBe(true);
    expect(sameValue(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameValue(1, '1')).toBe(false);
    expect(sameValue(['a'], ['a', 'b'])).toBe(false);
  });
});

describe('report format', () => {
  it('summarizes by cause and prints unexplained differences first', () => {
    const d = diffcheck(baumRuns, baum);
    const report = summarize(baumRuns.length, d);
    expect(report).toMatchObject({ runs: 11, agreed: 10, unexplained: 0 });
    expect(report.byCause).toEqual({ reported: 0, known: 0, not_convertible: 1, unexplained: 0 });
    const text = formatReport(report);
    expect(text).toContain('[not_convertible] unknown-task');
    expect(text.trimEnd().split('\n').at(-1)).toBe(
      '11 runs, 10 agree, 1 differences (reported 0, known 0, not_convertible 1, unexplained 0)',
    );
    // a wrong recording that no report item can explain (a refusal of a run that v4 accepts)
    const wrong: V3Run = {
      ...byId(meldungRuns, 'bearbeiten-ok'),
      recorded: { outcome: 'refused', reason: 'mistake' },
    };
    const unexplained = diffcheck([wrong], meldung);
    expect(unexplained).toMatchObject([{ kind: 'outcome', cause: 'unexplained' }]);
    const both = summarize(2, [...d.slice(0, 1), ...unexplained]);
    expect(both.unexplained).toBe(1);
    expect(formatReport(both).startsWith('[unexplained]')).toBe(true);
  });
});

describe('parseRuns', () => {
  it('accepts the fixtures and rejects a bad export with the place of the problem', () => {
    expect(parseRuns(baumRuns)).toHaveLength(11);
    expect(() => parseRuns({})).toThrow(RunsError);
    expect(() => parseRuns([{ id: 'a' }])).toThrow('runs[0].workflow');
    const ok = byId(baumRuns, 'erfassen-ok');
    expect(() => parseRuns([ok, ok])).toThrow('used twice');
    expect(() => parseRuns([{ ...ok, recorded: { outcome: 'maybe' } }])).toThrow('recorded.outcome');
    expect(() => parseRuns([{ ...ok, input: { vitalitaet: { x: 1 } } }])).toThrow('runs[0].input.vitalitaet');
  });
});

describe('performance', () => {
  it('replays 10,000 runs in under a minute (WP-302 budget)', () => {
    const many: V3Run[] = [];
    for (let i = 0; i < 10_000; i++) {
      const src = baumRuns[i % baumRuns.length] as V3Run;
      many.push({ ...src, id: `${src.id}-${i}` });
    }
    const d = diffcheck(many, baum);
    expect(d.length).toBe(many.filter((r) => r.id.startsWith('unknown-task-')).length);
  });
});
