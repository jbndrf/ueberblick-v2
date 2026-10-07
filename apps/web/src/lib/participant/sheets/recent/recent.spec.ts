import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { RECENT_LIMIT, anchorOfFeature, newest, recentFeatures, withActivity } from './recent';

const config = goldenConfig('projects/stadtwerke-meldungen.yaml');
const state = (id: string, type: string, seq: number, properties: object, deleted = false): FeatureState =>
  ({
    id,
    type: type as Key,
    properties,
    lifecycle: deleted ? 'deleted' : 'active',
    updatedSeq: seq,
  }) as unknown as FeatureState;

describe('newest', () => {
  it('equals the sorted-descending prefix for any input (property)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1000 })),
        fc.integer({ min: 1, max: 60 }),
        (seqs, limit) => {
          const all = seqs.map((n, i) => state(`f${i}`, 'meldung', n, {}));
          const got = newest(all, limit).map((s) => s.updatedSeq);
          const want = [...seqs].sort((a, b) => b - a).slice(0, limit);
          expect(got).toEqual(want);
        },
      ),
    );
  });

  it('skips deleted features', () => {
    expect(
      newest([state('a', 'meldung', 9, {}, true), state('b', 'meldung', 1, {})], 5).map((s) => s.id),
    ).toEqual(['b']);
  });
});

describe('recentFeatures', () => {
  const point = { type: 'Point', coordinates: [7.1, 50.7] };
  const all = [
    ...Array.from({ length: 60 }, (_, i) =>
      state(`m${i}`, 'meldung', i + 1, { geometrie: point, melder: 'max' }),
    ),
    state('e-new', 'einsatz', 100, { titel: 'Rohrbruch' }),
  ];
  const facts = { ofType: (t: Key) => all.filter((s) => s.type === t) };
  const deps = { facts, config, labelOf: (s: FeatureState) => `L-${s.id}`, locale: 'de' };

  it('lists the last 50 by activity, newest first, across Objektarten', () => {
    const rows = recentFeatures(deps);
    expect(rows).toHaveLength(RECENT_LIMIT);
    expect(rows[0]?.id).toBe('e-new');
    expect(rows[1]?.id).toBe('m59');
    expect(rows[49]?.id).toBe('m11');
  });

  it('an Objekt without geometry is listed and says it has no location', () => {
    const rows = recentFeatures(deps);
    expect(rows[0]?.hasLocation).toBe(false);
    expect(rows[1]?.hasLocation).toBe(true);
    expect(rows[0]?.label).toBe('L-e-new');
  });
});

describe('anchorOfFeature', () => {
  const deps = { config, geo: createGeo() };
  it('is the point of a point Objekt and none without geometry', () => {
    expect(
      anchorOfFeature(
        deps,
        state('m', 'meldung', 1, { geometrie: { type: 'Point', coordinates: [7.1, 50.7] } }),
      ),
    ).toEqual([7.1, 50.7]);
    expect(anchorOfFeature(deps, state('e', 'einsatz', 1, { titel: 'x' }))).toBeUndefined();
    expect(anchorOfFeature(deps, undefined)).toBeUndefined();
  });
});

describe('look and activity (WP-685)', () => {
  const marked = {
    ...config,
    file: {
      ...config.file,
      types: {
        ...config.file.types,
        meldung: { ...config.file.types?.meldung, marker: { color: '#dc2626' } },
      },
    },
  } as never;
  const s = state('m1', 'meldung', 5, {});
  const deps = {
    facts: { ofType: (t: Key) => (t === 'meldung' ? [s] : []) },
    config: marked,
    labelOf: () => 'L',
    locale: 'de',
  };

  it('a row carries the type look the map uses', () => {
    expect(recentFeatures(deps)[0]?.look.color).toBe('#dc2626');
  });

  it('withActivity adds the newest line, stage and time from the device, and leaves a cold row as it was', () => {
    const rows = recentFeatures(deps);
    const view = {
      segments: [
        {
          key: '0',
          stageLabel: 'Prüfung',
          visitIndex: 1,
          visitTotal: 1,
          initial: true,
          entries: [
            {
              runId: 'r1',
              task: 'Kontrolle',
              actorLabel: 'x',
              at: '2026-10-01T10:00:00.000Z',
              status: 'synced',
              label: { kind: 'fields', count: 3 },
              fields: [],
              touchedGeometry: false,
            },
          ],
        },
      ],
    } as never;
    const at = '2026-10-01T10:00:00.000Z' as never;
    const [warm] = withActivity(rows, { activityOf: () => view, updatedAt: () => at }, 'de');
    expect(warm).toMatchObject({ activity: '3 Felder aktualisiert', stage: 'Prüfung', updatedAt: at });
    const [cold] = withActivity(rows, { activityOf: () => undefined, updatedAt: () => undefined }, 'de');
    expect(cold?.activity).toBeUndefined();
    expect(cold?.look.color).toBe('#dc2626');
  });

  it('reads only the rows shown (O(rows), not all features)', () => {
    const rows = recentFeatures(deps);
    let reads = 0;
    withActivity(rows, { activityOf: () => (reads++, undefined), updatedAt: () => undefined }, 'de');
    expect(reads).toBe(rows.length);
  });
});

describe('recentFeatures respects the filter (WP-808)', () => {
  const all = [state('m1', 'meldung', 1, {}), state('m2', 'meldung', 5, {}), state('e1', 'einsatz', 9, {})];
  const facts = { ofType: (t: Key) => all.filter((s) => s.type === t) };
  const base = { facts, config, labelOf: (s: FeatureState) => s.id, locale: 'de' };

  it('does not list what the filter hides, and the page still fills with visible ones', () => {
    const rows = recentFeatures({ ...base, visible: (id) => id !== 'e1' && id !== 'm2' });
    expect(rows.map((r) => r.id)).toEqual(['m1']);
    expect(recentFeatures(base).map((r) => r.id)).toEqual(['e1', 'm2', 'm1']);
  });
});
