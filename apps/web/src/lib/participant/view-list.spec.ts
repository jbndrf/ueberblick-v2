import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { createViewList } from './view-source';
import { isServed } from '@ueberblick/core';

// WP-594: an own-list must not require a geometry (R4). The work order type of stadtwerke has none.
const config = goldenConfig('projects/stadtwerke-meldungen.yaml');
const state = (id: string, type: string, properties: object): FeatureState =>
  ({ id, type: type as Key, properties, lifecycle: 'active', updatedSeq: 1 }) as unknown as FeatureState;
const point = (lon: number) => ({ type: 'Point', coordinates: [lon, 50.7] });

const states = [
  state('e1', 'einsatz', { titel: 'A', zustaendig: 'hugo', status: 'neu' }),
  state('e2', 'einsatz', { titel: 'B', zustaendig: 'hans', status: 'neu' }),
  state('e3', 'einsatz', { titel: 'C', zustaendig: 'hugo', status: 'fertig' }),
  state('m1', 'meldung', { geometrie: point(7.1), melder: 'max', status: 'offen' }),
  state('m2', 'meldung', { melder: 'max', status: 'offen' }),
  state('m3', 'meldung', { geometrie: point(7.2), melder: 'mia', status: 'offen' }),
  { ...state('m4', 'meldung', { melder: 'max' }), lifecycle: 'deleted' as const },
];
const facts = {
  feature: (id: string) => states.find((s) => s.id === id),
  near: () => [], // the map's index: it never holds a feature without geometry
  ofType: (t: Key) => states.filter((s) => s.type === t && isServed(s.lifecycle)),
  edgesFrom: () => [],
  edgesTo: () => [],
  history: () => [],
};
const actor = (id: string, role: string): Actor => ({ id, kind: 'participant', roles: [role as Key] });
const rows = (view: string, who: Actor, extent?: [number, number, number, number]) =>
  createViewList({
    facts: facts as never,
    config,
    viewKey: view,
    actor: who,
    geo: createGeo(),
    now: () => '2026-09-30T10:00:00.000Z' as Instant,
    locales: ['de'],
  })
    .rows(extent)
    .map((r) => r.id)
    .sort();

describe('view list', () => {
  it('shows the work orders of a handwerker although they have no position', () => {
    expect(rows('meine_einsaetze', actor('hugo', 'handwerker'))).toEqual(['e1']);
    expect(rows('meine_einsaetze', actor('hans', 'handwerker'))).toEqual(['e2']);
  });

  it('shows the reports of a melder, with or without a position', () => {
    expect(rows('meine_meldungen', actor('max', 'melder'))).toEqual(['m1', 'm2']);
  });

  it('applies the view filter: an empty view stays empty', () => {
    expect(rows('melden', actor('max', 'melder'))).toEqual([]);
  });

  it('an extent clips features with a position and keeps those without', () => {
    expect(rows('meine_meldungen', actor('max', 'melder'), [7.5, 50, 8, 51])).toEqual(['m2']);
    expect(rows('meine_meldungen', actor('max', 'melder'), [7, 50, 7.15, 51])).toEqual(['m1', 'm2']);
  });

  it('names a row by the feature text its type holds, else by its type and a short id (WP-593)', () => {
    const named = createViewList({
      facts: facts as never,
      config,
      viewKey: 'meine_einsaetze',
      actor: actor('hugo', 'handwerker'),
      geo: createGeo(),
      now: () => '2026-09-30T10:00:00.000Z' as Instant,
      locales: ['de'],
    }).rows();
    expect(named.map((r) => r.name)).toEqual(['A']);
    const reports = createViewList({
      facts: facts as never,
      config,
      viewKey: 'meine_meldungen',
      actor: actor('mia', 'melder'),
      geo: createGeo(),
      now: () => '2026-09-30T10:00:00.000Z' as Instant,
      locales: ['en'],
    }).rows();
    expect(reports.map((r) => r.name)).toEqual(['Report #m3']);
  });

  it('renames the rows for another locale without reopening (WP-761)', () => {
    const list = createViewList({
      facts: facts as never,
      config,
      viewKey: 'meine_meldungen',
      actor: actor('mia', 'melder'),
      geo: createGeo(),
      now: () => '2026-09-30T10:00:00.000Z' as Instant,
      locales: ['de'],
    });
    const de = list.rows();
    expect(de.map((r) => r.name)).toEqual(['Meldung #m3']);
    expect(list.rename(de, ['en']).map((r) => r.name)).toEqual(['Report #m3']);
    expect(list.rename(list.rename(de, ['en']), ['de']).map((r) => r.name)).toEqual(['Meldung #m3']);
  });
});

describe('rowsOf (WP-800)', () => {
  const list = createViewList({
    facts: facts as never,
    config,
    viewKey: 'meine_einsaetze',
    actor: actor('hugo', 'handwerker'),
    geo: createGeo(),
    now: () => '2026-09-30T10:00:00.000Z' as Instant,
    locales: ['de'],
  });
  it('gives the rows rows() gives for those ids, and nothing for a feature the view does not show', () => {
    const some = list.rowsOf(['e1', 'e2', 'e3', 'zzz', 'm4'] as FeatureId[]);
    expect(some).toEqual(list.rows());
    expect(some.map((r) => r.id)).toEqual(['e1']);
  });
});
