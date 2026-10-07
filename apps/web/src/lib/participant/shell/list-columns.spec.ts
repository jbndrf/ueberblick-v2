/**
 * WP-713: a list cell is what the sheet's Daten row shows (one formatter, R1): the option's label instead of its key
 * ("erfasst", "v2"), a date and a number in the language of the app. The header is the property's label, the key only
 * when the template has none (v3 `ff.label ?? shortLabel(ff.id)`, map/+page.svelte:1446).
 */
import { describe, expect, it } from 'vitest';
import type { FeatureId, Key } from '@ueberblick/core/model';
import { goldenConfig } from '@ueberblick/core/testing';
import { deviceListLookup, listColumns } from './list-columns';

const veranstaltung = goldenConfig('templates/veranstaltung/1.0.0.yaml').file;
const maengel = goldenConfig('templates/maengelmelder/1.0.0.yaml').file;
const baum = goldenConfig('templates/baumkataster/1.0.0.yaml').file;
const lookup = {
  participant: (id: string) => ({ 'p-olga': 'Olga Beispiel' })[id],
  feature: (id: FeatureId) =>
    id === ('b1' as FeatureId) ? { label: 'Eiche 1', type: 'baum' as Key } : undefined,
};

describe('listColumns', () => {
  it('heads a column with the label in the app language, the key when the template has none', () => {
    const view = { source: { type: 'veranstaltung' }, properties: ['datum', 'antragsteller', 'ohne_label'] };
    const en = listColumns(veranstaltung, view as never, 'en', lookup);
    expect(en.map((c) => c.label)).toEqual(['Date', 'Applicant', 'ohne_label']);
    expect(listColumns(veranstaltung, view as never, 'de', lookup).map((c) => c.label)).toEqual([
      'Datum',
      'Antragsteller',
      'ohne_label',
    ]);
  });

  it('shows the option label, not the option key', () => {
    const view = { source: { type: 'baum' }, properties: ['stage', 'vitalitaet'] };
    const [stage, vitality] = listColumns(baum, view as never, 'de', lookup);
    expect(stage?.format?.('erfasst')).toBe('Erfasst');
    expect(vitality?.format?.('v2')).toBe('2');
  });

  it('formats a date and a number per language', () => {
    const date = listColumns(
      veranstaltung,
      { source: { type: 'veranstaltung' }, properties: ['datum'] } as never,
      'en',
      lookup,
    )[0];
    const dateDe = listColumns(
      veranstaltung,
      { source: { type: 'veranstaltung' }, properties: ['datum'] } as never,
      'de',
      lookup,
    )[0];
    expect(date?.format?.('2026-11-03')).toBe('Nov 3, 2026');
    expect(dateDe?.format?.('2026-11-03')).toBe('03.11.2026');
    const height = (l: 'de' | 'en') =>
      listColumns(
        baum,
        { source: { type: 'baum' }, properties: ['hoehe_m'] } as never,
        l,
        lookup,
      )[0]?.format?.(1234.5);
    expect(height('en')).toBe('1,234.5');
    expect(height('de')).toBe('1.234,5');
  });

  it('shows the label of a referenced Objekt and nothing for an empty value', () => {
    const col = listColumns(
      baum,
      { source: { type: 'baum' }, properties: ['art'] } as never,
      'de',
      lookup,
    )[0];
    expect(col?.format?.('b1')).toBe('Eiche 1');
    expect(col?.format?.(undefined)).toBe('');
  });

  it('without view properties takes the first three of the type that are no geometry or file', () => {
    const cols = listColumns(baum, { source: { type: 'baum' } } as never, 'de', lookup);
    expect(cols.map((c) => c.key)).toEqual(['art', 'stage', 'vitalitaet']);
  });

  it('shows a participant by name, "Jemand" for a person the device does not know, never the id', () => {
    const view = { source: { type: 'veranstaltung' }, properties: ['antragsteller'] };
    const [col] = listColumns(veranstaltung, view as never, 'de', lookup);
    expect(col?.format?.('p-olga')).toBe('Olga Beispiel');
    expect(col?.format?.('import-demo')).toBe('Jemand');
    expect(listColumns(veranstaltung, view as never, 'en', lookup)[0]?.format?.('import-demo')).toBe(
      'Someone',
    );
  });

  it('shows a localized_text in the app language, never [object Object]', () => {
    const view = { source: { type: 'meldung' }, properties: ['beschreibung'] };
    const [de] = listColumns(maengel, view as never, 'de', lookup);
    const [en] = listColumns(maengel, view as never, 'en', lookup);
    const value = { de: 'Schlagloch', en: 'Pothole' };
    expect(de?.format?.(value)).toBe('Schlagloch');
    expect(en?.format?.(value)).toBe('Pothole');
    expect(de?.format?.({ en: 'Pothole' })).toBe('Pothole');
    expect(de?.format?.('plain')).toBe('plain');
  });
});

describe('deviceListLookup', () => {
  it('asks the store for a name as a method of the store, so a store that keeps its people in `this` works', () => {
    const store = {
      people: new Map([['p-olga', 'Olga Beispiel']]),
      personName(id: string): string | undefined {
        return this.people.get(id);
      },
    };
    const device = { participant: { id: 'p-sven', name: 'Sven' }, store } as never;
    const { participant } = deviceListLookup(device);
    expect(participant('p-olga')).toBe('Olga Beispiel');
    expect(participant('p-sven')).toBe('Sven');
    expect(participant('p-fremd')).toBeUndefined();
  });
});
