// WP-674 (B-018): the Einfach rows group by the classifying property, with the colour and icon the map draws the value
// in, and a switched-off value hides its features (also when the property is not the stage).
import { describe, expect, it } from 'vitest';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { DEFAULT_MARKER_COLOR, resolveMarker } from '@ueberblick/core';
import { goldenConfig } from '@ueberblick/core/testing';
import type { FeatureSource, MapFeature } from '@ueberblick/ui';
import { createFilterController } from './filter-controller';
import { buildCards } from './filter-model';
import { filteredSource } from './filtered-source';

const meldung = goldenConfig('templates/maengelmelder/1.0.0.yaml');
const baumConfig = goldenConfig('templates/baumkataster/1.0.0.yaml');
const f = (id: string, type: string, props: Record<string, unknown>): FeatureState =>
  ({ id, type: type as Key, properties: props, lifecycle: 'active' }) as unknown as FeatureState;
const m = (id: string, kategorie: string, status = 'offen'): FeatureState =>
  f(id, 'meldung', { kategorie, status });

describe('buildCards with a classifying property', () => {
  const cards = buildCards(meldung, 'de', [
    m('1', 'muell'),
    m('2', 'muell'),
    m('3', 'strasse'),
    m('4', 'spielplatz', 'erledigt'),
  ]);
  const card = cards.find((c) => c.type === 'meldung');

  it('the value rows are the options of classify.property (not the stage), in declaration order, with counts', () => {
    expect(card?.values.map((v) => [v.value, v.count])).toEqual([
      ['strasse', 1],
      ['beleuchtung', 0],
      ['muell', 2],
      ['spielplatz', 1],
    ]);
  });
  it('a row carries the colour and icon of its value; the card those of the type marker', () => {
    const muell = card?.values.find((v) => v.value === 'muell');
    expect(muell?.color).toBe('#2f855a');
    expect(muell?.look.icon).toEqual({ key: 'trash-2' });
    expect(card?.look.icon).toEqual({ key: 'map-pin' });
    expect(card?.color).toBe('#4a5568');
    const spielplatz = card?.values.find((v) => v.value === 'spielplatz');
    expect(spielplatz?.look).toMatchObject({ color: '#d53f8c', size: 36 });
    expect(spielplatz?.look.icon).toHaveProperty('svg'); // the $ref icon is embedded
  });
  it('a stage classifying property keeps the stage rows and colours them', () => {
    const baum = buildCards(baumConfig, 'de', [f('1', 'baum', { stage: 'erfasst' })]).find(
      (c) => c.type === 'baum',
    );
    expect(baum?.values.map((v) => v.value)).toEqual(['erfasst', 'kontrolliert', 'massnahme', 'erledigt']);
    expect(baum?.values.find((v) => v.value === 'massnahme')?.color).toBe('#c05621');
  });
  it('a type with neither marker nor classify shows the one fallback look of the core, as the map does', () => {
    const flaeche = buildCards(baumConfig, 'de', [f('4', 'flaeche', {})]).find((c) => c.type === 'flaeche');
    expect(flaeche?.color).toBe(resolveMarker({}, undefined).color);
    expect(flaeche?.color).toBe(DEFAULT_MARKER_COLOR);
    expect(flaeche?.look.icon).toBeUndefined();
  });
});

describe('filteredSource by the classifying property', () => {
  const mf = (id: string): MapFeature =>
    ({
      id: id as FeatureId,
      anchor: [0, 0],
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: {},
    }) as MapFeature;

  it('a switched-off value of a classify.property that is not the stage hides its features', () => {
    const states = new Map<string, FeatureState>([
      ['1', m('1', 'muell')],
      ['2', m('2', 'strasse')],
      ['3', m('3', 'muell')],
    ]);
    const source: FeatureSource = {
      query: () => [...states.keys()].map(mf),
      *queryChunks() {
        yield [...states.keys()].map(mf);
      },
      subscribe: (_b, l) => {
        l({ add: [...states.keys()].map(mf), update: [], remove: [] });
        return () => undefined;
      },
    };
    const controller = createFilterController();
    const wrapped = filteredSource(source, (id) => states.get(id), meldung, controller);
    const world = [-180, -90, 180, 90] as const;
    expect(wrapped.query([...world]).map((x) => x.id)).toEqual(['1', '2', '3']);
    controller.setValue('meldung' as Key, 'muell', false);
    expect(wrapped.query([...world]).map((x) => x.id)).toEqual(['2']);
  });
});
