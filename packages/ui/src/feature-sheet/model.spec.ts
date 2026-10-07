import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Derived, FeatureType, Property, RunId } from '@ueberblick/core/model';
import { PROPERTY_TYPES } from '@ueberblick/core/registry';
import { buildFeatureSheetModel } from './model';
import { HISTORY_CAP, type ActivityEntry } from './contract';
import { AREA, TREE, edge, fid, input, k, tree, withProperty } from './fixtures';

const row = (over: Parameters<typeof input>[0], key: string) =>
  buildFeatureSheetModel(input(over)).rows.find((r) => r.key === key);

const entry = (i: number, property = 'name'): ActivityEntry => ({
  runId: `r${i}` as RunId,
  task: 'Inspect',
  actorLabel: 'Anna Beispiel',
  at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  status: 'accepted',
  changes: [{ property: k(property), result: `v${i}` }],
});

describe('property values are readable', () => {
  it('formats every property type of the registry', () => {
    const shown = new Set(Object.values(TREE.properties).map((p) => p.type));
    for (const key of PROPERTY_TYPES.keys) {
      if (key === 'integer' || key === 'multiselect' || key === 'localized_text' || key === 'time') continue; // below
      expect(shown, `fixture lacks ${key}`).toContain(key);
    }
  });

  it('text, number, boolean, date, datetime, select, participant', () => {
    const p = { feature: tree({ gemeldet: '2026-03-04T15:30:00Z' }) };
    expect(row(p, 'name')?.text).toBe('Oak');
    expect(row(p, 'hoehe')?.text).toBe('12.5');
    expect(row(p, 'gesund')?.text).toBe('Yes');
    expect(row(p, 'kontrolliert')?.text).toBe('Mar 4, 2026');
    expect(row(p, 'gemeldet')?.text).toMatch(/Mar 4, 2026/);
    expect(row(p, 'zustand')?.text).toBe('Poor');
    expect(row(p, 'melder')?.text).toBe('Anna Beispiel');
  });

  it('follows the locale', () => {
    const p = { locale: 'de' };
    expect(row(p, 'hoehe')?.text).toBe('12,5');
    expect(row(p, 'gesund')?.text).toBe('Ja');
    expect(row(p, 'zustand')?.text).toBe('Schlecht');
    expect(row(p, 'kontrolliert')?.label).toBe('Kontrolliert am');
    expect(row(p, 'kontrolliert')?.text).toMatch(/04\.03\.2026/);
  });

  it('integer, multiselect, localized_text', () => {
    const type: FeatureType = {
      label: 'T',
      properties: {
        n: { type: 'integer' },
        tags: { type: 'multiselect', options: { a: { en: 'A' }, b: { en: 'B' } } },
        note: { type: 'localized_text' },
      },
    };
    const feature = { ...tree(), properties: { n: 1200, tags: ['a', 'b'], note: { en: 'Hi', de: 'Hallo' } } };
    const rows = buildFeatureSheetModel(input({ feature, type, types: {} })).rows;
    expect(rows.map((r) => r.text)).toEqual(['1,200', 'A, B', 'Hi']);
  });

  it('a participant without a known name shows "Someone"/"Jemand", never the id', () => {
    expect(row({ feature: tree({ melder: 'p9' }) }, 'melder')?.text).toBe('Someone');
    expect(row({ feature: tree({ melder: 'p9' }), locale: 'de' }, 'melder')?.text).toBe('Jemand');
    expect(row({ feature: tree({ melder: 'p1' }) }, 'melder')?.text).toBe('Anna Beispiel');
  });

  it('a role shows its label, an unknown key as it is (WP-455)', () => {
    expect(row({ feature: tree({ rolle: 'kontrolle' }) }, 'rolle')?.text).toBe('Kontrolle');
    expect(row({ feature: tree({ rolle: 'weg' }) }, 'rolle')?.text).toBe('weg');
  });

  it('files: the file entries for the gallery (read from `sha256`), a count as text', () => {
    const r = row({}, 'foto');
    expect(r?.files).toEqual([
      { sha256: 'a'.repeat(64), name: 'baum.jpg', mime: 'image/jpeg' },
      { sha256: 'b'.repeat(64), name: 'plan.pdf', mime: 'application/pdf' },
    ]);
    expect(r?.text).toBe('2 files');
  });

  it('geometry: area or length from derived, never raw coordinates', () => {
    expect(row({}, 'flaeche')?.text).toBe('1,234.6 m²');
    expect(row({}, 'lage')?.text).toBe('Point');
    const line = tree();
    const feature = {
      ...line,
      derived: { flaeche: { ...(line.derived.flaeche as Derived), areaM2: 0, lengthM: 150 } },
      properties: {
        ...line.properties,
        flaeche: {
          type: 'LineString',
          coordinates: [
            [8, 50],
            [9, 51],
          ],
        },
      },
    };
    const text = row({ feature }, 'flaeche')?.text ?? '';
    expect(text).toBe('150 m');
    expect(text).not.toMatch(/\[|coordinates|LineString/);
  });

  it('a reference links to the feature; unknown targets show the id', () => {
    const feature = tree({ pate: 'g1' });
    expect(row({ feature }, 'pate')?.links).toEqual([{ id: fid('g1'), label: 'Park' }]);
    expect(row({ feature: tree({ pate: 'zz' }) }, 'pate')?.links).toEqual([{ id: fid('zz'), label: 'zz' }]);
  });

  it('a missing value is marked empty with words', () => {
    const r = row({}, 'gemeldet');
    expect(r?.empty).toBe(true);
    expect(r?.text).toBe('No value');
  });

  it('an empty or whitespace-only text is marked empty like a missing value (WP-855)', () => {
    for (const v of ['', '   ']) {
      const r = row({ feature: tree({ name: v }) }, 'name');
      expect(r?.empty).toBe(true);
      expect(r?.text).toBe('No value');
    }
  });

  it('odd objects never throw or reach user-controlled coercion, for every type', () => {
    const odd = [
      { toString: 1 },
      { valueOf: {} },
      { toString: 1, valueOf: 1, toJSON: 1 },
      JSON.parse('{"__proto__":{"toString":1}}'),
      [{ toString: 1 }],
      [[{ valueOf: {} }]],
    ];
    for (const type of PROPERTY_TYPES.keys)
      for (const value of odd) {
        const prop = { type, options: { a: { en: 'A' } }, to: k('person') } as unknown as Property;
        const t: FeatureType = { label: 'T', properties: { x: prop } };
        const f = { ...tree(), properties: { x: value as never }, derived: {} };
        const r = buildFeatureSheetModel(input({ feature: f, type: t, types: {} })).rows[0];
        expect(typeof r?.text, `${type}`).toBe('string');
      }
  });

  it('a value that does not match its type shows like an empty value', () => {
    const t: FeatureType = { label: 'T', properties: { x: { type: 'date' } as Property } };
    const f = { ...tree(), properties: { x: { toString: 1 } as never }, derived: {} };
    const r = buildFeatureSheetModel(input({ feature: f, type: t, types: {} })).rows[0];
    expect(r?.empty).toBe(true);
    expect(r?.text).toBe('No value');
  });

  it('a value that names an inherited member is shown as itself (regression: constructor, __proto__)', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const t: FeatureType = {
        label: 'T',
        properties: { s: { type: 'select', options: { a: { en: 'A' } } } as Property },
      };
      const f = { ...tree(), properties: { s: name }, derived: {} };
      const r = buildFeatureSheetModel(input({ feature: f, type: t, types: {} })).rows[0];
      expect(r?.text, name).toBe(name);
    }
  });

  it('every registry type formats without throwing for any JSON value', () => {
    const json = fc.jsonValue() as fc.Arbitrary<never>;
    fc.assert(
      fc.property(fc.constantFrom(...PROPERTY_TYPES.keys), json, (type, value) => {
        const options = { a: { en: 'A' } };
        const prop = { type, options: type.endsWith('select') ? options : undefined, to: k('person') };
        const clean = Object.fromEntries(Object.entries(prop).filter(([, v]) => v !== undefined));
        const t: FeatureType = { label: 'T', properties: { x: clean as unknown as Property } };
        const f = { ...tree(), properties: { x: value }, derived: {} };
        const rows = buildFeatureSheetModel(input({ feature: f, type: t, types: {} })).rows;
        expect(typeof rows[0]?.text).toBe('string');
      }),
      { numRuns: Number(process.env['FS_RUNS'] ?? 300) },
    );
  });
});

describe('what is shown', () => {
  it('shows the properties of the type in order; the selector narrows and orders them', () => {
    const all = buildFeatureSheetModel(input()).rows.map((r) => r.key);
    expect(all).toEqual(Object.keys(TREE.properties));
    const some = buildFeatureSheetModel(input({ properties: [k('hoehe'), k('name'), k('nope')] }));
    expect(some.rows.map((r) => r.key)).toEqual(['hoehe', 'name']);
    expect(JSON.stringify(some)).not.toContain('hidden value');
  });

  it('hidden properties are absent from history too', () => {
    const activity: ActivityEntry[] = [
      entry(2, 'name'),
      { ...entry(1, 'geheim'), changes: [{ property: k('geheim'), result: 'x' }] },
    ];
    const m = buildFeatureSheetModel(input({ activity, properties: [k('name')] }));
    expect(m.history).toHaveLength(1);
  });

  it('a personal flag on a property changes nothing here', () => {
    const marked: FeatureType = {
      ...TREE,
      properties: {
        ...TREE.properties,
        name: withProperty({
          ...(TREE.properties.name as Property),
          personal: { subject: 'actor' },
        } as Property),
      },
    };
    expect(buildFeatureSheetModel(input({ type: marked }))).toEqual(buildFeatureSheetModel(input()));
  });

  it('title is the display name, the same function the list row uses (WP-593)', () => {
    expect(buildFeatureSheetModel(input()).title).toBe('Oak');
    const f = tree({ name: undefined, geheim: undefined });
    expect(buildFeatureSheetModel(input({ feature: f })).title).toBe('Tree #t1');
    expect(buildFeatureSheetModel(input({ feature: f, locale: 'de' })).title).toBe('Baum #t1');
  });
});

describe('time property', () => {
  it('shows the HH:MM text as it is', () => {
    const type: FeatureType = {
      ...TREE,
      properties: { ...TREE.properties, fenster: { type: 'time', label: { en: 'Window' } } as Property },
    };
    expect(
      row({ type, feature: tree({ fenster: '14:30' }), properties: [k('fenster')] }, 'fenster')?.text,
    ).toBe('14:30');
  });
});

describe('tasks', () => {
  it('are the given keys in order with localized labels; unknown label falls back to the key', () => {
    const m = buildFeatureSheetModel(
      input({ availableTasks: [k('kontrolle'), k('faellen')], taskLabels: { kontrolle: { en: 'Inspect' } } }),
    );
    expect(m.tasks).toEqual([
      { key: 'kontrolle', label: 'Inspect' },
      { key: 'faellen', label: 'faellen' },
    ]);
  });
});

describe('relations', () => {
  const edgesOut = [
    edge('t1', 'in_gebiet', 'g1', true),
    edge('t1', 'pate', 'g2', false),
    edge('t1', 'pate', 'g1', false),
  ];

  it('groups by relation label; derived and reference both show', () => {
    const m = buildFeatureSheetModel(input({ edgesOut }));
    const inArea = m.relations.find((g) => g.id === 'out:in_gebiet');
    expect(inArea?.label).toBe('Area');
    expect(inArea?.items).toEqual([{ id: 'g1', label: 'Park', derived: true }]);
    const pate = m.relations.find((g) => g.id === 'out:pate');
    expect(pate?.label).toBe('Sponsor');
    expect(pate?.items.map((i) => [i.label, i.derived])).toEqual([
      ['g2', false],
      ['Park', false],
    ]);
    expect(m.relations).toHaveLength(2);
  });

  it('incoming edges are labelled by the relation of the type they come from', () => {
    const feature = { ...tree(), id: fid('g1'), type: k('gebiet'), properties: { name: 'Park' } };
    const m = buildFeatureSheetModel(
      input({ feature, type: AREA, edgesIn: [edge('t1', 'in_gebiet', 'g1', true)] }),
    );
    expect(m.relations).toHaveLength(1);
    expect(m.relations[0]?.incoming).toBe(true);
    expect(m.relations[0]?.label).toBe('in_gebiet (incoming)');
    expect(m.relations[0]?.items[0]?.derived).toBe(true);
  });

  it('no edges → no groups', () => {
    expect(buildFeatureSheetModel(input()).relations).toEqual([]);
  });
});

describe('history', () => {
  it('says who, what and when, newest first', () => {
    const m = buildFeatureSheetModel(input({ activity: [entry(2), entry(1)] }));
    expect(m.history.map((h) => h.value)).toEqual(['v2', 'v1']);
    expect(m.history[0]).toMatchObject({ who: 'Anna Beispiel', what: 'Name', at: entry(2).at });
  });

  it('caps at 10 per property (property test)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom('name', 'hoehe'), fc.nat(500)), { maxLength: 80 }),
        (list) => {
          const activity = list.map(([p, i]) => entry(i, p)).sort((a, b) => (a.at < b.at ? 1 : -1));
          const m = buildFeatureSheetModel(input({ activity }));
          for (const p of ['Name', 'Height']) {
            expect(m.history.filter((h) => h.what === p).length).toBeLessThanOrEqual(HISTORY_CAP);
          }
          const times = m.history.map((h) => h.at);
          expect(times).toEqual([...times].sort().reverse());
        },
      ),
    );
  });
});
