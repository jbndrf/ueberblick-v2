import { describe, expect, it } from 'vitest';
import { autoMap, buildMapping, LAT, LON, missingRequired, targetsOf, type MappingState } from './mapping';
import type { ImportSetup } from './setup';

const setup: ImportSetup = {
  task: 'erfassen',
  taskLabel: 'Baum erfassen',
  fields: [
    { key: 'art', label: 'Art', required: true, kind: 'text' },
    { key: 'hoehe_m', label: 'Höhe (m)', required: false, kind: 'number' },
    { key: 'beschreibung', label: 'Beschreibung', required: false, kind: 'localized_text', language: 'de' },
  ],
  geometry: { field: 'geometrie', point: true, required: true },
  stage: { property: 'stage', label: 'Status', start: 'erfasst', options: [] },
  constants: [
    { key: 'hoehe_klasse', label: 'Klasse', kind: 'text', options: [] },
    { key: 'faellig', label: 'Fällig', kind: 'boolean', options: [] },
    { key: 'zahl', label: 'Zahl', kind: 'number', options: [] },
  ],
};
const labels = { lon: 'Längengrad (lon)', lat: 'Breitengrad (lat)' };
const state = (over: Partial<MappingState> = {}): MappingState => ({
  columns: {},
  stage: 'erfasst',
  constants: [],
  crs: 'EPSG:4326',
  ...over,
});

describe('targetsOf', () => {
  it('puts the coordinate columns first (v3 specialColumns), then the form fields', () => {
    const t = targetsOf(setup, labels);
    expect(t.map((x) => [x.id, x.required])).toEqual([
      [LON, true],
      [LAT, true],
      ['art', true],
      ['hoehe_m', false],
      ['beschreibung', false],
    ]);
  });
  it('a type without a point geometry has no coordinate columns', () => {
    const t = targetsOf({ ...setup, geometry: { field: 'g', point: false, required: false } }, labels);
    expect(t.some((x) => x.id === LON)).toBe(false);
  });
});

describe('autoMap (v3: header equals label, case-insensitive); keys and coordinate names too', () => {
  it('maps by label, key and the usual coordinate names, each target once', () => {
    const m = autoMap(['ART', 'hoehe_m', 'Latitude', 'lng', 'Bemerkung', 'art'], targetsOf(setup, labels));
    expect(m).toEqual({ ART: 'art', hoehe_m: 'hoehe_m', Latitude: LAT, lng: LON });
  });
});

describe('missingRequired (v3: all fields marked * must be mapped)', () => {
  it('lists required targets without a column', () => {
    const targets = targetsOf(setup, labels);
    expect(missingRequired(targets, { A: 'art' }).map((t) => t.id)).toEqual([LON, LAT]);
    expect(missingRequired(targets, { A: 'art', B: LON, C: LAT })).toEqual([]);
  });
});

describe('buildMapping: the body the endpoints take', () => {
  it('maps columns to form fields, names the language of a localized text, and the coordinates', () => {
    const m = buildMapping(
      setup,
      state({ columns: { Art: 'art', Text: 'beschreibung', X: LON, Y: LAT, Skip: '' } }),
      ';',
    );
    expect(m).toEqual({
      task: 'erfassen',
      fields: { art: 'Art', beschreibung: { column: 'Text', language: 'de' } },
      geometry: { field: 'geometrie', x: 'X', y: 'Y' },
      sourceCrs: 'EPSG:4326',
      delimiter: ';',
      constants: { stage: 'erfasst' },
    });
  });

  it('a stage chosen is a constant of the stage property; none chosen leaves it out', () => {
    expect(buildMapping(setup, state({ stage: 'kontrolliert' }), ',').constants).toEqual({
      stage: 'kontrolliert',
    });
    expect(buildMapping(setup, state({ stage: '' }), ',').constants).toBeUndefined();
  });

  it('constants take the type of their property; empty rows are left out', () => {
    const m = buildMapping(
      setup,
      state({
        stage: '',
        constants: [
          { key: 'hoehe_klasse', value: 'mittel' },
          { key: 'faellig', value: 'true' },
          { key: 'zahl', value: '2,5' },
          { key: 'zahl', value: '' },
          { key: '', value: 'x' },
        ],
      }),
      ',',
    );
    expect(m.constants).toEqual({ hoehe_klasse: 'mittel', faellig: true, zahl: 2.5 });
  });

  it('sends the coordinate system the admin chose, and no geometry when a coordinate column is missing', () => {
    const m = buildMapping(setup, state({ columns: { X: LON }, crs: 'EPSG:25832' }), ',');
    expect(m.geometry).toBeUndefined();
    const g = buildMapping(setup, state({ columns: { X: LON, Y: LAT }, crs: 'EPSG:25832' }), ',');
    expect(g.sourceCrs).toBe('EPSG:25832');
  });
});

describe('buildMapping for a Tabelle (WP-433)', () => {
  it('names the type next to `$create` and sends no geometry', () => {
    const table: ImportSetup = {
      task: '$create',
      type: 'arten',
      taskLabel: 'Arten',
      fields: [{ key: 'name', label: 'Name', required: true, kind: 'text' }],
      geometry: null,
      stage: null,
      constants: [],
    };
    const m = buildMapping(table, state({ columns: { Name: 'name' }, stage: '' }), ';');
    expect(m).toEqual({ task: '$create', type: 'arten', fields: { name: 'Name' }, delimiter: ';' });
    expect(targetsOf(table, labels).map((t) => t.id)).toEqual(['name']);
  });
});
