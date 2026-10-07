import { describe, expect, it } from 'vitest';
import { correctionValues } from './correct';
import { buildColumns, filterLabelOf, shapeRow, type ColumnsInput } from './columns';

const labels = {
  status: 'Status',
  stage: 'Stufe',
  createdBy: 'Erstellt von',
  location: 'Standort',
  created: 'Erstellt',
  yes: 'Ja',
  no: 'Nein',
};

const baum: ColumnsInput['type'] = {
  label: { de: 'Baum' },
  geometry: 'geometrie',
  process: { property: 'stage', start: 'erfasst', end: ['gefaellt'] },
  properties: {
    geometrie: { type: 'geometry', geometry_type: 'point' },
    stage: {
      type: 'select',
      label: { de: 'Phase' },
      options: { erfasst: { de: 'Erfasst', en: 'Captured' }, gefaellt: { de: 'Gefällt', en: 'Felled' } },
    },
    befund: { type: 'text', label: { de: 'Befund' } },
    hoehe_m: { type: 'number', label: { de: 'Höhe' } },
    kontrolle: { type: 'boolean', label: { de: 'Kontrolle' } },
    faellig: { type: 'date', label: { de: 'Fällig' } },
    zuletzt: { type: 'datetime' },
    arten: { type: 'multiselect', options: { a: { de: 'A' }, b: { de: 'B' } } },
    zustaendig: { type: 'participant', label: { de: 'Zuständig' } },
    fotos: { type: 'file', label: { de: 'Fotos' } },
    titel: { type: 'localized_text', label: { de: 'Titel' } },
  },
};

const input = (over: Partial<ColumnsInput> = {}): ColumnsInput => ({
  type: baum,
  locale: 'de',
  labels,
  names: { u1: 'Anna Beispiel', a1: 'chef@example.org' },
  actors: { system: 'System', importBy: (a) => `Import (${a})` },
  ...over,
});

describe('buildColumns', () => {
  it('lists v3 columns in v3 order: Status, Stufe, Erstellt von, Standort, properties, Erstellt', () => {
    const keys = buildColumns(input()).map((c) => [c.key, c.label]);
    expect(keys).toEqual([
      ['$lifecycle', 'Status'],
      ['stage', 'Stufe'],
      ['$created_by', 'Erstellt von'],
      ['$location', 'Standort'],
      ['befund', 'Befund'],
      ['hoehe_m', 'Höhe'],
      ['kontrolle', 'Kontrolle'],
      ['faellig', 'Fällig'],
      ['zuletzt', 'zuletzt'],
      ['arten', 'arten'],
      ['zustaendig', 'Zuständig'],
      ['fotos', 'Fotos'],
      ['titel', 'Titel'],
      ['$created_at', 'Erstellt'],
    ]);
  });

  it('has no Stufe column without a process and no Standort without a geometry', () => {
    const type = { ...baum, process: undefined, geometry: undefined };
    const keys = buildColumns(input({ type })).map((c) => c.key);
    expect(keys).not.toContain('$location');
    // the select is then an ordinary property, labelled by its own name
    expect(keys).toContain('stage');
    expect(buildColumns(input({ type })).find((c) => c.key === 'stage')?.label).toBe('Phase');
  });

  it('maps property types to cell kinds and server abilities', () => {
    const col = (k: string) => buildColumns(input()).find((c) => c.key === k);
    expect(col('befund')).toMatchObject({ kind: 'text' });
    expect(col('befund')?.sortable).not.toBe(false); // BaseTable: absent means yes
    expect(col('befund')?.filterable).not.toBe(false);
    expect(col('hoehe_m')).toMatchObject({ kind: 'number' });
    expect(col('kontrolle')).toMatchObject({ kind: 'boolean' });
    expect(col('faellig')).toMatchObject({ kind: 'date', dateMode: 'date' });
    expect(col('zuletzt')).toMatchObject({ kind: 'date', dateMode: 'datetime' });
    expect(col('arten')).toMatchObject({ kind: 'array', sortable: false });
    expect(col('arten')?.filterable).not.toBe(false);
    expect(col('fotos')).toMatchObject({ sortable: false, filterable: false });
    expect(col('titel')).toMatchObject({ sortable: false, filterable: false });
    expect(col('$location')).toMatchObject({ sortable: false, filterable: false });
    expect(col('$created_at')).toMatchObject({ kind: 'date', dateMode: 'datetime', filterable: false });
    expect(col('$created_by')?.sortable).not.toBe(false);
    expect(col('$created_by')?.filterable).not.toBe(false);
  });

  it('gives selects their option labels in the language', () => {
    const stage = buildColumns(input({ locale: 'en' })).find((c) => c.key === 'stage');
    expect(stage).toMatchObject({ kind: 'array', singleSelect: true });
    expect(stage?.options).toEqual([
      { value: 'erfasst', label: 'Captured' },
      { value: 'gefaellt', label: 'Felled' },
    ]);
  });

  it('never makes a geometry property a column', () => {
    expect(buildColumns(input()).map((c) => c.key)).not.toContain('geometrie');
  });

  it('makes the property columns editable (Bearbeitungsmodus, WP-370) but never the stage or a system column', () => {
    const cols = buildColumns(input());
    expect(cols.filter((c) => c.editable).map((c) => c.key)).toEqual([
      'befund',
      'hoehe_m',
      'kontrolle',
      'faellig',
      'zuletzt',
      'arten',
    ]);
    expect(cols.find((c) => c.key === 'stage')?.editable).toBe(false);
  });
});

describe('shapeRow', () => {
  const api = {
    $id: 'f1',
    $lifecycle: 'completed',
    $created_by: 'u1',
    $created_at: '2026-01-02T08:00:00.000Z',
    $changed_at: null,
    lon: 7.12345,
    lat: 50.1,
    stage: 'erfasst',
    befund: 'Pilz',
    zustaendig: 'u1',
    titel: { de: 'Eiche', en: 'Oak' },
    arten: ['a'],
  };

  it('shows the participant name, not the id, and keeps unknown ids', () => {
    const r = shapeRow(api, input());
    expect(r['$created_by']).toBe('Anna Beispiel');
    expect(r['zustaendig']).toBe('Anna Beispiel');
    expect(shapeRow({ ...api, $created_by: 'admin:x' }, input())['$created_by']).toBe('admin:x');
    expect(shapeRow({ ...api, $created_by: 'a1' }, input())['$created_by']).toBe('chef@example.org');
    expect(shapeRow({ ...api, $created_by: 'import:a1' }, input())['$created_by']).toBe(
      'Import (chef@example.org)',
    );
    expect(shapeRow({ ...api, $created_by: 'system' }, input())['$created_by']).toBe('System');
    expect(shapeRow({ ...api, $created_by: null }, input())['$created_by']).toBeNull();
  });

  it('wraps a select into a list (v3 array cell) and a localized text into its language', () => {
    const r = shapeRow(api, input());
    expect(r['stage']).toEqual(['erfasst']);
    expect(r['arten']).toEqual(['a']);
    expect(r['titel']).toBe('Eiche');
    expect(shapeRow(api, input({ locale: 'en' }))['titel']).toBe('Oak');
    expect(shapeRow({ ...api, stage: undefined }, input())['stage']).toEqual([]);
  });

  it('writes the location as "lat, lon" and adds the shape for a line or polygon (v3 `:396-411`)', () => {
    expect(shapeRow(api, input())['$location']).toBe('50.1000, 7.1235');
    const line = {
      ...baum,
      properties: { ...baum.properties, geometrie: { type: 'geometry', geometry_type: 'line' } },
    };
    expect(shapeRow(api, input({ type: line as ColumnsInput['type'] }))['$location']).toBe(
      '50.1000, 7.1235 (line)',
    );
    expect(shapeRow({ ...api, lon: null, lat: null }, input())['$location']).toBe('');
  });

  it('uses the feature id as the row id', () => {
    expect(shapeRow(api, input()).id).toBe('f1');
  });
});

describe('filterLabelOf', () => {
  const label = filterLabelOf(input());
  it('labels lifecycle states, options, booleans and participants', () => {
    expect(label('$lifecycle', 'completed')).toBe('abgeschlossen');
    expect(label('stage', 'gefaellt')).toBe('Gefällt');
    expect(label('kontrolle', 'true')).toBe('Ja');
    expect(label('kontrolle', 'false')).toBe('Nein');
    expect(label('$created_by', 'u1')).toBe('Anna Beispiel');
    expect(label('$created_by', 'a1')).toBe('chef@example.org');
    expect(label('$created_by', 'import:a1')).toBe('Import (chef@example.org)');
    expect(label('$created_by', 'system')).toBe('System');
    expect(label('$created_by', 'unbekannt')).toBe('unbekannt');
    expect(label('zustaendig', 'zz')).toBe('zz');
    expect(label('befund', 'Pilz')).toBe('Pilz');
  });
});

describe('shapeRow with Mehrfachauswahl and Anzeigefeld (WP-443)', () => {
  const type: ColumnsInput['type'] = {
    ...baum,
    properties: {
      ...baum.properties,
      team: { type: 'participant', cardinality: 'many' },
      nachbar: { type: 'reference', to: 'baum' },
      nachbarn: { type: 'reference', to: 'baum', cardinality: 'many', display_property: 'befund' },
    },
  } as ColumnsInput['type'];
  const referenceName = (key: string, id: string) =>
    ({ b1: 'Linde', b2: key === 'nachbarn' ? 'Riss' : undefined })[id];

  it('lists several participants and several references by name, in order', () => {
    const r = shapeRow(
      { $id: 'f1', team: ['u1', 'u9'], nachbar: 'b1', nachbarn: ['b1', 'b2', 'b3'] },
      input({ type, referenceName }),
    );
    expect(r['team']).toBe('Anna Beispiel, u9');
    expect(r['nachbar']).toBe('Linde');
    expect(r['nachbarn']).toBe('Linde, Riss, #b3');
  });

  it('shows the short id (core shortId) when no reference name is given, never the raw id', () => {
    const id = 'a7d3d241-8c7e-71ca-8727-44ab2c8a8720';
    const r = shapeRow({ $id: 'f1', nachbar: id, nachbarn: [id] }, input({ type }));
    expect(r['nachbar']).toBe('#8720');
    expect(r['nachbarn']).toBe('#8720');
  });
});

describe('role properties (WP-455)', () => {
  const type = {
    ...baum,
    properties: {
      ...baum.properties,
      rolle: { type: 'role' },
      rollen: { type: 'role', cardinality: 'many' },
    },
  } as ColumnsInput['type'];
  const roleLabels = { kontrolle: { de: 'Kontrolle' }, verwaltung: { de: 'Verwaltung' } };

  it('shows role labels in cells, unknown keys as they are', () => {
    const r = shapeRow(
      { $id: 'f1', rolle: 'weg', rollen: ['verwaltung', 'weg'] },
      input({ type, roleLabels: {} }),
    );
    expect(r['rolle']).toBe('weg');
    expect(r['rollen']).toBe('verwaltung, weg');
  });
  it('is an editable select of the roles when the project has roles (v3 data page)', () => {
    const cols = buildColumns(input({ type, roleLabels }));
    expect(cols.find((c) => c.key === 'rolle')).toMatchObject({
      kind: 'array',
      singleSelect: true,
      editable: true,
      options: [
        { value: 'kontrolle', label: 'Kontrolle' },
        { value: 'verwaltung', label: 'Verwaltung' },
      ],
    });
    expect(cols.find((c) => c.key === 'rollen')).toMatchObject({ singleSelect: false, editable: true });
    const r = shapeRow(
      { $id: 'f1', rolle: 'kontrolle', rollen: ['verwaltung'] },
      input({ type, roleLabels }),
    );
    expect(r['rolle']).toEqual(['kontrolle']);
    expect(correctionValues(type, { rolle: ['verwaltung'], rollen: ['kontrolle', 'verwaltung'] })).toEqual({
      rolle: 'verwaltung',
      rollen: ['kontrolle', 'verwaltung'],
    });
  });
  it('shows role labels as text without roles; has a text column and labels the filter values', () => {
    expect(buildColumns(input({ type })).find((c) => c.key === 'rolle')?.kind).toBe('text');
    expect(filterLabelOf(input({ type, roleLabels }))('rolle', 'verwaltung')).toBe('Verwaltung');
  });
});
