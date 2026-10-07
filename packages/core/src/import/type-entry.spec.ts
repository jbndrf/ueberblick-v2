import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { whoAdmits, WHO_ADMIN, WHO_IMPORT } from '../perms';
import { FeatureTypeSchema, TaskSchema } from '../schema';
import { importedType, keyFromName, stringifyForText } from './index';

describe('keyFromName', () => {
  it('makes a key from a name, unique among the taken ones', () => {
    expect(keyFromName('Hochstämme Süd', [], 'x')).toBe('hochstaemme_sued');
    expect(keyFromName('Baum', ['baum', 'baum_2'], 'x')).toBe('baum_3');
    expect(keyFromName('2024 Funde', [], 'x')).toBe('t_2024_funde');
    expect(keyFromName('!!!', [], 'objektart')).toBe('objektart');
  });

  it('property: matches the key pattern and is not taken', () => {
    fc.assert(
      fc.property(fc.string(), fc.array(fc.string(), { maxLength: 5 }), (name, taken) => {
        const key = keyFromName(name, taken, 'x');
        expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(taken).not.toContain(key);
      }),
    );
  });
});

describe('importedType who', () => {
  it('the creating task admits the import (and the admin), or every imported row is refused (C-005)', () => {
    const r = importedType({ name: 'Baum', geometry: 'point', columns: [] }, 'baum', []);
    expect(r.task.who).toEqual([WHO_ADMIN, WHO_IMPORT]);
    const who = r.task.who as string[];
    expect(whoAdmits({ who }, { kind: 'import', roles: [] } as never)).toBe(true);
  });
});

describe('importedType', () => {
  const columns = [
    { name: 'Art', type: 'text' },
    { name: 'Höhe (m)', type: 'number' },
    { name: 'Notiz', type: 'long_text' },
    { name: 'geometrie', type: 'boolean' },
    { name: 'Gepflanzt', type: 'date' },
  ] as const;

  it('a type with a geometry property, the columns as properties and a creating task', () => {
    const r = importedType({ name: 'Hochstämme', geometry: 'point', columns }, 'hochstaemme', []);
    expect(r.taskKey).toBe('hochstaemme_import');
    expect(r.type).toMatchObject({
      label: 'Hochstämme',
      geometry: 'geometrie',
      properties: {
        geometrie: { type: 'geometry', geometry_type: 'point' },
        art: { type: 'text', label: 'Art' },
        hoehe_m: { type: 'number', label: 'Höhe (m)' },
        notiz: { type: 'text', label: 'Notiz' },
        geometrie_2: { type: 'boolean', label: 'geometrie' },
        gepflanzt: { type: 'date', label: 'Gepflanzt' },
      },
    });
    expect(r.task).toMatchObject({
      on: '$none',
      creates: 'hochstaemme',
      form: { geometrie: {}, art: {}, notiz: { appearance: 'multiline' } },
    });
    expect(r.mapping).toEqual({
      task: 'hochstaemme_import',
      fields: {
        art: 'Art',
        hoehe_m: 'Höhe (m)',
        notiz: 'Notiz',
        geometrie_2: 'geometrie',
        gepflanzt: 'Gepflanzt',
      },
      geometry: { field: 'geometrie' },
    });
    expect(FeatureTypeSchema.safeParse(r.type).success).toBe(true);
    expect(TaskSchema.safeParse(r.task).success).toBe(true);
  });

  it('without a geometry there is no geometry property and no geometry mapping (a Tabelle)', () => {
    const r = importedType(
      { name: 'Liste', geometry: null, columns: [{ name: 'a', type: 'text' }] },
      'liste',
      ['liste_import'],
    );
    expect(r.taskKey).toBe('liste_import_2');
    expect(r.type).not.toHaveProperty('geometry');
    expect(r.mapping.geometry).toBeUndefined();
    expect(FeatureTypeSchema.safeParse(r.type).success).toBe(true);
  });

  it('property: any column names give distinct valid property keys and a mapping for each', () => {
    const col = fc.record({
      name: fc.string({ minLength: 1 }),
      type: fc.constantFrom('text', 'number', 'boolean', 'date', 'long_text'),
    });
    fc.assert(
      fc.property(fc.array(col, { maxLength: 8 }), (cols) => {
        const r = importedType({ name: 'T', geometry: 'point', columns: cols }, 't', []);
        const keys = Object.keys(r.type['properties'] as object);
        expect(new Set(keys).size).toBe(keys.length);
        expect(Object.keys(r.mapping.fields)).toHaveLength(cols.length);
        expect(FeatureTypeSchema.safeParse(r.type).success).toBe(true);
      }),
    );
  });
});

describe('stringifyForText', () => {
  const collection = {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature', geometry: null, properties: { a: 1, b: { x: 1 }, c: 'k', d: true } },
      { type: 'Feature', geometry: null, properties: { a: null } },
    ],
  };

  it('writes non-text values of text columns as text, leaves the other columns', () => {
    const out = stringifyForText(collection, { a: 'text', b: 'long_text', c: 'text', d: 'boolean' });
    expect(out.features[0]?.properties).toEqual({ a: '1', b: '{"x":1}', c: 'k', d: true });
    expect(out.features[1]?.properties).toEqual({ a: null });
  });

  it('returns the same collection when nothing changes', () => {
    expect(stringifyForText(collection, { a: 'number', b: 'number', c: 'text', d: 'boolean' })).toBe(
      collection,
    );
  });
});
