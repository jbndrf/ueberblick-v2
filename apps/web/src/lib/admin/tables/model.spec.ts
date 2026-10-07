// WP-382: what the Tabellen pages read from the project file.
import { isTable, type TemplateFile } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { audienceOf, columnsOf, isColumnType, summariesOf } from './model';

const file = {
  types: {
    baum: {
      label: 'Baum',
      geometry: 'geo',
      properties: { geo: { type: 'geometry', geometry_type: 'point' } },
    },
    ablauf: {
      label: 'Ablauf',
      process: { property: 'stufe', start: 'a', end: ['b'] },
      properties: { stufe: { type: 'select', options: { a: 'A', b: 'B' } } },
    },
    ausruestung: {
      label: { de: 'Ausrüstung', en: 'Equipment' },
      description: { de: 'Geräte', en: 'Devices' },
      permissions: { see: ['bauhof', 'verwaltung'] },
      properties: {
        titel: { type: 'text', label: { de: 'Titel', en: 'Title' }, required: true },
        stueck: { type: 'number', label: 'Stück', default: 1 },
        aktiv: { type: 'boolean' },
      },
    },
    strassen: {
      label: 'Straßen',
      permissions: { see: '$all' },
      properties: { name: { type: 'text', label: 'Name', required: true } },
    },
  },
} as unknown as TemplateFile;

describe('tables model', () => {
  it('a table is a type without geometry and without a process', () => {
    const t = file.types ?? {};
    expect(
      Object.entries(t)
        .filter(([, d]) => isTable(d))
        .map(([k]) => k),
    ).toEqual(['ausruestung', 'strassen']);
  });

  it('summarises each table in the page language: label, description, first column (Q15) and audience', () => {
    const [a, s] = summariesOf(file, 'en');
    expect(a).toMatchObject({
      key: 'ausruestung',
      label: 'Equipment',
      description: 'Devices',
      mainLabel: 'Title',
      audience: { kind: 'roles', roles: ['bauhof', 'verwaltung'] },
    });
    expect(s).toMatchObject({ key: 'strassen', description: '', audience: { kind: 'all' } });
  });

  it('the audience is none without a see list or with a per-property map', () => {
    const t = file.types ?? {};
    const base = t['strassen'];
    if (base === undefined) throw new Error('fixture');
    expect(audienceOf({ ...base, permissions: undefined })).toEqual({ kind: 'none' });
    expect(audienceOf({ ...base, permissions: { see: { name: ['x'] } } } as never)).toEqual({ kind: 'none' });
  });

  it('lists the columns in the order of the properties, with required, default and pending', () => {
    const t = file.types ?? {};
    const def = t['ausruestung'];
    if (def === undefined) throw new Error('fixture');
    const deployed = { ...def, properties: { titel: def.properties['titel'] } } as never;
    expect(columnsOf(def, 'de', deployed)).toEqual([
      { key: 'titel', label: 'Titel', type: 'text', required: true, pending: false },
      { key: 'stueck', label: 'Stück', type: 'number', required: false, default: 1, pending: true },
      { key: 'aktiv', label: 'aktiv', type: 'boolean', required: false, pending: true },
    ]);
    expect(columnsOf(def, 'de', undefined).every((c) => c.pending)).toBe(true);
  });

  it('offers v3 four column types', () => {
    expect(['text', 'number', 'date', 'boolean'].every(isColumnType)).toBe(true);
    expect(isColumnType('select')).toBe(false);
  });
});
