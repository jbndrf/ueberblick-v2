import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FeatureType, RunId } from '@ueberblick/core/model';
import type { ActivityEntry } from './contract';
import { buildActivity } from './activity';
import { TREE, fid, input, k, tree } from './fixtures';

const STAGED: FeatureType = {
  ...TREE,
  properties: {
    ...TREE.properties,
    stufe: {
      type: 'select',
      label: { en: 'Stage', de: 'Stufe' },
      options: { erfasst: { en: 'Recorded', de: 'Erfasst' }, pruefung: { en: 'Review', de: 'Prüfung' } },
    },
  },
  process: { property: k('stufe'), start: k('erfasst'), end: [k('pruefung')] },
};

type Change = readonly [string, unknown];
const run = (n: number, changes: Change[], over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  runId: `r${n}` as RunId,
  task: `Task ${n}`,
  actorLabel: 'Anna Beispiel',
  at: new Date(Date.UTC(2026, 0, 1, n)).toISOString(),
  status: 'accepted',
  changes: changes.map(([property, result]) => ({ property: k(property), result: result as never })),
  ...over,
});
// The reader hands entries newest first.
const view = (entries: ActivityEntry[], type: FeatureType = STAGED, over = {}) =>
  buildActivity(input({ type, activity: entries.reverse(), ...over }));

describe('buildActivity', () => {
  it('has no segments without runs and without a creation time', () => {
    expect(view([]).segments).toEqual([]);
  });

  it('groups runs by stage visit, newest first, with the visit count when a stage is visited twice', () => {
    const v = view([
      run(1, [
        ['$type', 'baum'],
        ['stufe', 'erfasst'],
        ['name', 'Oak'],
      ]),
      run(2, [['hoehe', 3]]),
      run(3, [['stufe', 'pruefung']]),
      run(4, [['hoehe', 4]]),
      run(5, [['stufe', 'erfasst']]),
    ]);
    expect(v.segments.map((s) => [s.stageLabel, s.visitIndex, s.visitTotal, s.initial])).toEqual([
      ['Recorded', 2, 2, false],
      ['Review', 1, 1, false],
      ['Recorded', 1, 2, true],
    ]);
    expect(v.segments[0]?.transition?.by).toBe('Anna Beispiel');
    expect(v.segments[1]?.entries.map((e) => e.runId)).toEqual(['r4']);
    // the creating run is the header of the first segment; its stage write is the start, not a move
    expect(v.segments[2]?.creation?.runId).toBe('r1');
    expect(v.segments[2]?.entries.map((e) => e.runId)).toEqual(['r2']);
  });

  // WP-726: the device never receives `$type`, so the creating run is the run made at the feature's createdAt.
  describe('the creating run known from the audit fields', () => {
    const created = (n: number) => ({ createdAt: new Date(Date.UTC(2026, 0, 1, n)).toISOString() });
    const withAudit = (entries: ActivityEntry[], n: number) =>
      view(entries, STAGED, { feature: { ...tree(), ...created(n) } });

    it('a create run that writes only the start stage is one entry, Erstellt in the start stage', () => {
      const v = withAudit([run(1, [['stufe', 'erfasst']])], 1);
      expect(v.segments).toHaveLength(1);
      expect(v.segments[0]?.transition).toBeUndefined();
      expect(v.segments[0]?.stageLabel).toBe('Recorded');
      expect(v.segments[0]?.creation?.runId).toBe('r1');
      expect(v.segments[0]?.created).toBeUndefined();
    });

    it('a create run that moves on in its then is Erstellt in the start stage plus one move', () => {
      const v = withAudit(
        [
          run(1, [
            ['stufe', 'erfasst'],
            ['name', 'Oak'],
            ['stufe', 'pruefung'],
          ]),
        ],
        1,
      );
      expect(v.segments.map((s) => [s.stageLabel, s.initial])).toEqual([
        ['Review', false],
        ['Recorded', true],
      ]);
      expect(v.segments[1]?.creation?.runId).toBe('r1');
      expect(v.segments[0]?.transition?.by).toBe('Anna Beispiel');
    });

    it('a later run is not taken for the creation', () => {
      const v = withAudit([run(1, [['stufe', 'erfasst']]), run(2, [['stufe', 'pruefung']])], 1);
      expect(v.segments.map((s) => s.stageLabel)).toEqual(['Review', 'Recorded']);
    });
  });

  it('a stage move with other values in the same run starts the segment with that run as entry', () => {
    const v = view([
      run(1, [
        ['stufe', 'pruefung'],
        ['hoehe', 3],
      ]),
    ]);
    expect(v.segments.map((s) => s.stageKey)).toEqual(['pruefung']); // the empty initial segment is dropped, as v3
    expect(v.segments[0]?.entries).toHaveLength(1);
    expect(v.segments[0]?.entries[0]?.fields.map((f) => f.key)).toEqual(['hoehe']);
  });

  it('labels a run by its changes: field, location, count or the task', () => {
    const v = view([
      run(1, [['hoehe', 1]]),
      run(2, [['lage', { type: 'Point', coordinates: [1, 2] }]]),
      run(3, [
        ['hoehe', 1],
        ['name', 'x'],
      ]),
      run(4, []),
    ]);
    const labels = v.segments[0]?.entries.map((e) => e.label);
    expect(labels).toEqual([
      { kind: 'task' },
      { kind: 'fields', count: 2 },
      { kind: 'location' },
      { kind: 'field', label: 'Height' },
    ]);
  });

  it('keeps the last value per property of a run, and never lists reserved keys, the stage or other types', () => {
    const e = view([
      run(1, [
        ['hoehe', 1],
        ['hoehe', 2],
        ['$lifecycle', 'x'],
        ['unknown', 1],
      ]),
    ]).segments[0]?.entries[0];
    expect(e?.fields.map((f) => [f.key, f.text])).toEqual([['hoehe', '2']]);
  });

  it('shows empty values as empty and files with their thumbnails', () => {
    const file = { sha256: 'a'.repeat(64), name: 'a.jpg', mime: 'image/jpeg' };
    const e = view([
      run(1, [
        ['hoehe', null],
        ['foto', [file]],
        ['zustand', 'gut'],
        ['pate', ['p9']],
      ]),
    ]).segments[0]?.entries[0];
    const by = Object.fromEntries((e?.fields ?? []).map((f) => [f.key, f]));
    expect(by['hoehe']?.empty).toBe(true);
    expect(by['foto']?.files).toEqual([file]);
    expect(by['zustand']?.text).toBe('Good');
    expect(by['pate']?.links).toEqual([{ id: 'p9', label: 'p9' }]);
  });

  it('leaves out what the role may not read', () => {
    const e = view(
      [
        run(1, [
          ['hoehe', 1],
          ['name', 'x'],
        ]),
      ],
      STAGED,
      { properties: [k('name')] },
    ).segments[0]?.entries[0];
    expect(e?.fields.map((f) => f.key)).toEqual(['name']);
    expect(e?.label).toEqual({ kind: 'field', label: 'Name' });
  });

  it('carries the status of own pending and refused runs', () => {
    const v = view([
      run(1, [['hoehe', 1]]),
      run(2, [['hoehe', 2]], { status: 'pending' }),
      run(3, [['stufe', 'pruefung']], { status: 'refused' }),
    ]);
    expect(v.segments[0]?.transition?.status).toBe('refused');
    expect(v.segments[1]?.entries.map((e) => e.status)).toEqual(['pending', 'accepted']);
  });

  it('falls back to the creation time and creator of the sync row when the creating run is not here', () => {
    const feature = { ...tree(), createdAt: '2026-01-01T00:00:00.000Z', createdBy: 'p1' } as never;
    const v = view([run(2, [['hoehe', 3]])], STAGED, { feature });
    expect(v.segments).toHaveLength(1);
    expect(v.segments[0]?.created).toEqual({ at: '2026-01-01T00:00:00.000Z', by: 'Anna Beispiel' });
    expect(v.segments[0]?.creation).toBeUndefined();
    const only = view([], STAGED, { feature });
    expect(only.segments[0]?.created?.at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('has no stage headers for a type without a process', () => {
    const v = view([run(1, [['hoehe', 1]])], TREE);
    expect(v.segments).toHaveLength(1);
    expect(v.segments[0]?.stageKey).toBeUndefined();
  });

  it('every run appears exactly once (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('hoehe', 'stufe:pruefung', 'stufe:erfasst', 'name', 'lage'), {
          maxLength: 40,
        }),
        (picks) => {
          const entries = picks.map((p, i) => {
            const [key, value] = p.split(':');
            return run(i + 1, [[key as string, value ?? 'x']]);
          });
          const v = view(entries);
          const seen = v.segments.flatMap((s) => [
            ...(s.creation ? [s.creation.runId] : []),
            ...s.entries.map((e) => e.runId),
          ]);
          const moves = picks.filter((p) => p.startsWith('stufe')).length;
          // a bare stage move has no entry of its own; it is the segment header
          expect(seen.length).toBe(picks.length - moves);
          expect(v.segments.filter((s) => !s.initial)).toHaveLength(moves);
        },
      ),
    );
  });

  it('builds the timeline of 500 runs in one pass (bounded by one feature)', () => {
    const entries = Array.from({ length: 500 }, (_, i) => run(i + 1, [['hoehe', i]]));
    const v = buildActivity(
      input({ type: STAGED, activity: entries, feature: { ...tree(), id: fid('t9') } }),
    );
    expect(v.segments).toHaveLength(1);
    expect(v.segments[0]?.entries).toHaveLength(500);
  });
});
