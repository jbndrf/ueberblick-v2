// WP-674 (B-018): cluster rows group by the classifying property and take the colour the map draws the value in.
import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { buildClusterGroups } from './groups';

const meldung = goldenConfig('templates/maengelmelder/1.0.0.yaml');
const baum = goldenConfig('templates/baumkataster/1.0.0.yaml');
const states = new Map<string, FeatureState>();
const add = (id: string, type: string, props: Record<string, unknown>): FeatureId => {
  states.set(id, {
    id,
    type: type as Key,
    properties: props,
    lifecycle: 'active',
  } as unknown as FeatureState);
  return id as FeatureId;
};
const members = (...ids: FeatureId[]) => ids.map((id) => ({ id, at: [8, 50] as [number, number] }));
const feature = (id: FeatureId) => states.get(id);

describe('buildClusterGroups with a classifying property', () => {
  const m = (id: string, kategorie: string) => add(id, 'meldung', { kategorie, status: 'offen' });
  const ids = [m('m1', 'muell'), m('m2', 'muell'), m('m3', 'strasse')];

  it('one row per value of classify.property, in the value colour, biggest first', () => {
    const rows = buildClusterGroups(meldung, 'de', members(...ids), feature)[0]?.rows;
    expect(rows?.map((r) => [r.key, r.label, r.count, r.color])).toEqual([
      ['muell', 'Müll', 2, '#2f855a'],
      ['strasse', 'Straße', 1, '#4a5568'],
    ]);
  });
  it('a stage row takes its classify colour, as the map does (v3 drew it grey)', () => {
    const e = add('x1', 'baum', { stage: 'massnahme' });
    const row = buildClusterGroups(baum, 'de', members(e), feature)[0]?.rows[0];
    expect(row?.color).toBe('#c05621');
  });
});
