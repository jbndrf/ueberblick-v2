// WP-644: the Daten read view needs more than text: selections as badges in the option order the property declares,
// the property type to pick the box, and the history grouped per property with "cleared" entries.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { FeatureId, FeatureType, FoldedFeature, Key } from '@ueberblick/core/model';
import type { ActivityEntry, FeatureSheetInput } from './contract';
import { orderByOptions } from './format';
import { buildFeatureSheetModel } from './model';

const type: FeatureType = {
  label: 'Baum',
  geometry: 'lage',
  properties: {
    arten: { type: 'multiselect', options: { a: 'Eiche', b: 'Buche', c: 'Ahorn' } },
    zustand: { type: 'select', options: { gut: 'Gut' } },
    notiz: { type: 'text' },
    lage: { type: 'geometry' },
  },
};
const feature = (properties: Record<string, unknown>): FoldedFeature =>
  ({
    id: 't1' as FeatureId,
    type: 'baum' as Key,
    deleted: false,
    updatedSeq: 1,
    properties,
    derived: {},
  }) as unknown as FoldedFeature;
const input = (properties: Record<string, unknown>, activity: ActivityEntry[] = []): FeatureSheetInput => ({
  feature: feature(properties),
  type,
  types: { baum: type },
  availableTasks: [],
  taskLabels: {},
  edgesOut: [],
  edgesIn: [],
  activity,
  lookups: { participant: () => undefined, feature: () => undefined },
  locale: 'de',
});

describe('orderByOptions', () => {
  it('orders by the declared options, unknown values last in their own order', () => {
    expect(orderByOptions(['c', 'x', 'a', 'y'], ['a', 'b', 'c'])).toEqual(['a', 'c', 'x', 'y']);
  });
  it('is a permutation of its input (property test)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.string(), { maxLength: 12 }),
        fc.array(fc.string(), { maxLength: 12 }),
        (sel, canon) => {
          expect([...orderByOptions(sel, canon)].sort()).toEqual([...sel].sort());
        },
      ),
    );
  });
});

describe('rows for the read view', () => {
  it('a multiselect has badges in option order, not click order', () => {
    const row = buildFeatureSheetModel(input({ arten: ['c', 'a'] })).rows.find((r) => r.key === 'arten');
    expect(row).toMatchObject({ kind: 'multiselect', badges: ['Eiche', 'Ahorn'], empty: false });
  });
  it('a select has one badge; text has none', () => {
    const rows = buildFeatureSheetModel(input({ zustand: 'gut', notiz: 'a\nb' })).rows;
    expect(rows.find((r) => r.key === 'zustand')?.badges).toEqual(['Gut']);
    expect(rows.find((r) => r.key === 'notiz')).toMatchObject({ badges: [], multiline: true });
  });
  it('single-line text is not multiline; an empty value has no badges', () => {
    const rows = buildFeatureSheetModel(input({ notiz: 'kurz' })).rows;
    expect(rows.find((r) => r.key === 'notiz')?.multiline).toBe(false);
    expect(rows.find((r) => r.key === 'arten')).toMatchObject({ empty: true, badges: [] });
  });
});

describe('history rows', () => {
  const run = (n: number, result: unknown): ActivityEntry => ({
    runId: `r${n}` as ActivityEntry['runId'],
    task: 'k',
    actorLabel: 'Anna',
    at: `2026-01-0${n}T10:00:00.000Z` as ActivityEntry['at'],
    status: 'synced' as ActivityEntry['status'],
    changes: [{ property: 'notiz' as Key, result: result as never }],
  });
  it('names the property and marks a cleared value', () => {
    const m = buildFeatureSheetModel(input({}, [run(2, null), run(1, 'x')]));
    expect(m.history.map((h) => [h.property, h.cleared, h.value])).toEqual([
      ['notiz', true, ''],
      ['notiz', false, 'x'],
    ]);
  });
});
