// WP-382: every edit of a table is an overlay op on the draft (Q16); the first property is the Hauptspalte (Q15).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '@ueberblick/builder';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { columnsOf, summariesOf } from '../../../../../../lib/admin/tables/model';
import type { ColumnSpec } from '../../../../../../lib/admin/tables/types';
import { createTable, deleteTable, saveColumns, updateTable, type TableEdit } from './table-ops';

const golden = (rel: string): string =>
  embedGoldenSource(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../../../fixtures/golden/${rel}`, import.meta.url)),
      'utf8',
    ),
  );
const open = (): Doc =>
  openProject(golden('templates/baumkataster/1.1.0.yaml'), golden('projects/musterstadt-baeume.yaml'));
const must = (r: TableEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const type = (d: Doc, key: string) => d.effective().types?.[key];
const cols = (d: Doc, key: string, locale = 'de') => {
  const def = type(d, key);
  if (def === undefined) throw new Error(`no ${key}`);
  return columnsOf(def, locale, undefined);
};
const spec = (d: Doc, key: string): ColumnSpec[] =>
  cols(d, key).map((c) => ({
    key: c.key,
    label: c.label,
    type: c.type,
    ...(c.required ? { required: true } : {}),
    ...(c.default === undefined ? {} : { default: c.default }),
  }));

describe('createTable', () => {
  it('adds a type without geometry and process with one required text column, visible to every role', () => {
    const r = createTable(
      open(),
      { name: 'Ausrüstung', mainColumn: 'Bezeichnung', description: 'Geräte' },
      'de',
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.key).toBe('ausruestung');
    const def = type(r.doc, 'ausruestung');
    expect(def?.geometry).toBeUndefined();
    expect(def?.process).toBeUndefined();
    expect(def?.permissions?.see).toBe('$all');
    expect(cols(r.doc, 'ausruestung')).toEqual([
      { key: 'bezeichnung', label: 'Bezeichnung', type: 'text', required: true, pending: true },
    ]);
    expect(summariesOf(r.doc.effective(), 'de').find((s) => s.key === 'ausruestung')).toMatchObject({
      label: 'Ausrüstung',
      description: 'Geräte',
      mainLabel: 'Bezeichnung',
    });
  });

  it('takes the typed table name as the key, and refuses a bad or a taken one', () => {
    const doc = open();
    expect(createTable(doc, { name: 'X', key: 'geraete', mainColumn: 'Name' }, 'de')).toMatchObject({
      ok: true,
      key: 'geraete',
    });
    expect(createTable(doc, { name: 'X', key: 'Bad Key', mainColumn: 'Name' }, 'de')).toMatchObject({
      ok: false,
      code: 'bad_key',
    });
    expect(createTable(doc, { name: 'X', key: 'baumart', mainColumn: 'Name' }, 'de')).toMatchObject({
      ok: false,
      code: 'key_exists',
    });
    expect(createTable(doc, { name: ' ', mainColumn: 'Name' }, 'de')).toMatchObject({
      ok: false,
      code: 'name_empty',
    });
  });

  it('writes the roles it is given as the audience', () => {
    const r = must(createTable(open(), { name: 'Geräte', mainColumn: 'Name', roles: ['bauhof'] }, 'de'));
    expect(type(r, 'geraete')?.permissions?.see).toEqual(['bauhof']);
  });
});

describe('updateTable', () => {
  it('renames, describes and sets the roles; "no roles" is every role (v3 "Alle")', () => {
    const d = must(
      updateTable(
        open(),
        'baumart',
        { name: 'Baumarten', description: 'Liste', roles: ['verwaltung'] },
        'de',
      ),
    );
    expect(summariesOf(d.effective(), 'de').find((s) => s.key === 'baumart')).toMatchObject({
      label: 'Baumarten',
      description: 'Liste',
      audience: { kind: 'roles', roles: ['verwaltung'] },
    });
    const all = must(updateTable(d, 'baumart', { roles: [] }, 'de'));
    expect(type(all, 'baumart')?.permissions?.see).toBe('$all');
  });

  it('renaming the Hauptspalte renames the first column and keeps its key', () => {
    const d = must(updateTable(open(), 'baumart', { mainColumn: 'Deutscher Name' }, 'de'));
    expect(cols(d, 'baumart')[0]).toMatchObject({ key: 'name_de', label: 'Deutscher Name' });
  });

  it('refuses an unknown table', () => {
    expect(updateTable(open(), 'gibtsnicht', { name: 'x' }, 'de')).toMatchObject({
      ok: false,
      code: 'unknown_table',
    });
  });
});

describe('saveColumns', () => {
  it('adds a column at the end, with its type, required flag and default', () => {
    const before = spec(open(), 'baumart');
    const d = must(
      saveColumns(
        open(),
        'baumart',
        [...before, { key: 'anzahl', label: 'Anzahl', type: 'number', required: true, default: 3 }],
        'de',
      ),
    );
    expect(cols(d, 'baumart').map((c) => c.key)).toEqual(['name_de', 'name_lat', 'anzahl']);
    expect(cols(d, 'baumart')[2]).toMatchObject({ type: 'number', required: true, default: 3 });
  });

  it('makes the key of a new column from its name, unique among the properties (the temporary key is dropped)', () => {
    const before = spec(open(), 'baumart');
    const d = must(
      saveColumns(
        open(),
        'baumart',
        [
          ...before,
          { key: 'new:1', label: 'Straße', type: 'text' },
          { key: 'new:2', label: 'Strasse 2', type: 'text' },
          { key: 'new:3', label: 'Name De', type: 'text' },
        ],
        'de',
      ),
    );
    expect(cols(d, 'baumart').map((c) => c.key)).toEqual([
      'name_de',
      'name_lat',
      'strasse',
      'strasse_2',
      'name_de_2',
    ]);
  });

  it('renames a column and changes its type and default; the key stays', () => {
    const before = spec(open(), 'baumart');
    const next = before.map((c) =>
      c.key === 'name_lat' ? { ...c, label: 'Botanisch', type: 'text', default: 'n.n.' } : c,
    );
    const d = must(saveColumns(open(), 'baumart', next, 'de'));
    expect(cols(d, 'baumart')[1]).toMatchObject({ key: 'name_lat', label: 'Botanisch', default: 'n.n.' });
    const retyped = must(
      saveColumns(
        d,
        'baumart',
        spec(d, 'baumart').map((c) =>
          c.key === 'name_lat' ? { key: c.key, label: c.label, type: 'date' } : c,
        ),
        'de',
      ),
    );
    expect(cols(retyped, 'baumart')[1]?.type).toBe('date');
  });

  it('removes a column, from the draft only', () => {
    const before = spec(open(), 'baumart');
    const d = must(
      saveColumns(
        open(),
        'baumart',
        before.filter((c) => c.key !== 'name_lat'),
        'de',
      ),
    );
    expect(cols(d, 'baumart').map((c) => c.key)).toEqual(['name_de']);
  });

  it('reorders: the first column in the new order is the Hauptspalte (Q15)', () => {
    const before = spec(open(), 'baumart');
    const d = must(saveColumns(open(), 'baumart', [...before].reverse(), 'de'));
    expect(cols(d, 'baumart').map((c) => c.key)).toEqual(['name_lat', 'name_de']);
    expect(summariesOf(d.effective(), 'de').find((s) => s.key === 'baumart')?.mainLabel).toBe(
      'Lateinischer Name',
    );
  });

  it('adds, renames and reorders in one save', () => {
    const before = spec(open(), 'baumart');
    const next: ColumnSpec[] = [
      { key: 'neu', label: 'Neu', type: 'boolean' },
      ...before.map((c) => (c.key === 'name_de' ? { ...c, label: 'Name' } : c)),
    ];
    const d = must(saveColumns(open(), 'baumart', next, 'de'));
    expect(cols(d, 'baumart').map((c) => [c.key, c.label])).toEqual([
      ['neu', 'Neu'],
      ['name_de', 'Name'],
      ['name_lat', 'Lateinischer Name'],
    ]);
  });

  it('refuses an empty name, two columns with one name and an unknown table', () => {
    const before = spec(open(), 'baumart');
    expect(
      saveColumns(open(), 'baumart', [...before, { key: 'x', label: ' ', type: 'text' }], 'de'),
    ).toMatchObject({
      ok: false,
      code: 'column_empty',
    });
    expect(
      saveColumns(open(), 'baumart', [...before, { key: 'x', label: 'Name', type: 'text' }], 'de'),
    ).toMatchObject({ ok: false, code: 'column_exists' });
    expect(saveColumns(open(), 'nope', before, 'de')).toMatchObject({ ok: false, code: 'unknown_table' });
  });
});

describe('deleteTable', () => {
  it('removes a table of the draft', () => {
    const made = must(createTable(open(), { name: 'Geräte', mainColumn: 'Name' }, 'de'));
    const gone = must(deleteTable(made, 'geraete'));
    expect(type(gone, 'geraete')).toBeUndefined();
  });

  it('refuses while another type still points at the table (a reference)', () => {
    const r = deleteTable(open(), 'baumart');
    expect(r).toMatchObject({ ok: false, code: 'problem' });
  });
});
