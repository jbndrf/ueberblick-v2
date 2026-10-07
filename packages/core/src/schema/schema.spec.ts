import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from 'yaml';
import {
  FeatureTypeSchema,
  GeoJsonGeometrySchema,
  KeyPathSchema,
  KeySchema,
  LocalizedStringSchema,
  OverlayFileSchema,
  PropertySchema,
  ProjectFileSchema,
  TemplateFileSchema,
  ViewSchema,
  parseProjectFile,
  relationCardinality,
} from './index';
import {
  PERSONAL_SUBJECT_KINDS,
  AUDIENCES,
  PROPERTY_TYPES,
  RENDERERS,
  AUTO_TIMING_KINDS,
  TASK_OFFERS,
} from '../registry';
import { formatKeyPath, parseKeyPath } from '../template/paths';
import { AutoEntrySchema } from './auto';
import { TaskSchema } from './task';

const raw = import.meta.glob('./__fixtures__/valid/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const casesRaw = import.meta.glob('./__fixtures__/invalid/cases.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const a004Raw = import.meta.glob('./__fixtures__/*/a004-cases.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const valid = (name: string): unknown => parse(raw[`./__fixtures__/valid/${name}.yaml`] as string);

interface Case {
  name: string;
  path: string;
  file: unknown;
}
const cases = parse(Object.values(casesRaw)[0] as string) as Case[];
const a004 = (dir: 'valid' | 'invalid'): Case[] =>
  parse(a004Raw[`./__fixtures__/${dir}/a004-cases.yaml`] as string) as Case[];

describe('keys', () => {
  it('accepts ^[a-z][a-z0-9_]*$', () => {
    for (const k of ['baum', 'a', 'kontroll_2', 'x9']) expect(KeySchema.safeParse(k).success).toBe(true);
  });
  it('rejects anything else', () => {
    for (const k of ['Baum', '1a', '_a', 'a-b', 'a b', '', 'ä'])
      expect(KeySchema.safeParse(k).success).toBe(false);
  });
  it('property: a string is a key iff it matches the pattern', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(KeySchema.safeParse(s).success).toBe(/^[a-z][a-z0-9_]*$/.test(s));
      }),
    );
  });
});

describe('LocalizedString', () => {
  it('takes a string or a language map', () => {
    expect(LocalizedStringSchema.safeParse('Baum').success).toBe(true);
    expect(LocalizedStringSchema.safeParse({ de: 'Baum', en: 'Tree' }).success).toBe(true);
    expect(LocalizedStringSchema.safeParse({}).success).toBe(false);
    expect(LocalizedStringSchema.safeParse({ DE: 'x' }).success).toBe(false);
  });
});

describe('docs/05 sketches parse', () => {
  it('template', () => {
    const r = parseProjectFile(valid('template'));
    expect(r.error?.issues).toBeUndefined();
    expect(TemplateFileSchema.safeParse(valid('template')).success).toBe(true);
    expect(ProjectFileSchema.safeParse(valid('template')).success).toBe(true);
  });
  it('overlay', () => {
    expect(OverlayFileSchema.safeParse(valid('overlay')).success).toBe(true);
    expect(parseProjectFile(valid('overlay')).success).toBe(true);
    expect(ProjectFileSchema.safeParse(valid('overlay')).success).toBe(true);
  });
});

describe('entities are ID-keyed maps', () => {
  it('rejects a list for every entity section', () => {
    const base = valid('template') as Record<string, unknown>;
    for (const section of ['types', 'tasks', 'views', 'roles', 'tools']) {
      const r = parseProjectFile({ ...base, [section]: [{ key: 'x' }] });
      expect(r.success, section).toBe(false);
      expect(r.error?.issues[0]?.path.join('.'), section).toBe(section);
    }
  });
});

describe('negative fixtures', () => {
  it('has at least 12 cases', () => expect(cases.length).toBeGreaterThanOrEqual(12));
  it.each(cases)('$name -> $path', ({ path, file }) => {
    const r = parseProjectFile(file);
    expect(r.success).toBe(false);
    const paths = (r.error?.issues ?? []).map((i) => i.path.join('.'));
    expect(paths, JSON.stringify(r.error?.issues)).toContain(path);
  });
});

describe('A-004 / A-005 positive fixtures', () => {
  const positives = a004('valid');
  it('has at least one positive fixture per A-004 item 1-11', () => {
    for (let i = 1; i <= 11; i++)
      expect(
        positives.some((c) => c.name.startsWith(`A-004 ${i} `)),
        `item ${i}`,
      ).toBe(true);
  });
  it.each(positives)('$name', ({ file }) => {
    const r = parseProjectFile(file);
    expect(r.error?.issues).toBeUndefined();
  });
});

describe('A-004 / A-005 negative fixtures', () => {
  const negatives = a004('invalid');
  it('has at least one negative fixture per A-004 item 1-11', () => {
    const all = [...negatives, ...cases];
    for (let i = 1; i <= 11; i++)
      expect(
        all.some((c) => c.name.startsWith(`A-004 ${i} `)),
        `item ${i}`,
      ).toBe(true);
  });
  it.each(negatives)('$name -> $path', ({ path, file }) => {
    const r = parseProjectFile(file);
    expect(r.success).toBe(false);
    const paths = (r.error?.issues ?? []).map((i) => i.path.join('.'));
    expect(paths, JSON.stringify(r.error?.issues)).toContain(path);
  });
});

describe('key paths (A-005 item 1)', () => {
  it('the schema and template/paths share one grammar (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 4 }), (segs) => {
        const path = formatKeyPath(segs);
        expect(KeyPathSchema.safeParse(path).success).toBe(true);
        expect(parseKeyPath(path)).toEqual(segs);
      }),
    );
  });
  it('accepts bare keys and bracketed JSON strings, rejects the rest', () => {
    for (const p of ['types.baum', 'style["circle-color"]', 'label["en-GB"].x', '["a.b"]'])
      expect(KeyPathSchema.safeParse(p).success, p).toBe(true);
    for (const p of ['', 'Types.baum', 'a..b', 'a.', 'style[circle]', 'a["x"', 'style.circle-color', 'a.0'])
      expect(KeyPathSchema.safeParse(p).success, p).toBe(false);
  });
});

describe('relation cardinality defaults (A-004 item 3)', () => {
  it('one for a picked reference, many for derive and inverse_of, explicit wins', () => {
    expect(relationCardinality({ to: 'a' })).toBe('one');
    expect(relationCardinality({ to: 'a', derive: 'true' })).toBe('many');
    expect(relationCardinality({ to: 'a', inverse_of: 'a.b' })).toBe('many');
    expect(relationCardinality({ to: 'a', derive: 'true', cardinality: 'one' })).toBe('one');
  });
});

describe('registries feed the schema', () => {
  it('every timing kind of the registry but the implicit one is a key of an automatic action, and vice versa', () => {
    const keyed = AUTO_TIMING_KINDS.entries.filter((e) => e.form !== 'implicit').map((e) => e.key);
    const shape = Object.keys(AutoEntrySchema.shape);
    for (const k of keyed) expect(shape, k).toContain(k);
    expect(AUTO_TIMING_KINDS.entries.filter((e) => e.form === 'implicit').map((e) => e.key)).toEqual([
      'edge',
    ]);
  });
  it("the edge timing is no key, runs on a device and needs a `when`: the entry's or the task's (A-045)", () => {
    const entry = AUTO_TIMING_KINDS.entries.find((e) => e.key === 'edge');
    expect(entry?.server_only).toBe(false);
    expect(AutoEntrySchema.safeParse({ when: 'self.n > 1' }).success).toBe(true);
    const task = (t: object) => TaskSchema.safeParse({ label: 'T', on: 'baum', ...t }).success;
    expect(task({ auto: { r: {} } })).toBe(false);
    expect(task({ when: 'self.n > 1', auto: { r: {} } })).toBe(true);
    expect(task({ auto: { r: { when: 'self.n > 1' } } })).toBe(true);
    expect(AutoEntrySchema.safeParse({ when: 'self.n > 1', extra: 1 }).success).toBe(false);
  });
  it('`idle` belongs to a `schedule`', () => {
    expect(AutoEntrySchema.safeParse({ schedule: '0 3 * * 1', idle: 'days(7)' }).success).toBe(true);
    expect(AutoEntrySchema.safeParse({ after: 'k', idle: 'days(7)' }).success).toBe(false);
  });
  it('keywords carry the $ sigil and no key can', () => {
    for (const k of [...TASK_OFFERS.keys, ...AUDIENCES.keys]) {
      expect(k.startsWith('$')).toBe(true);
      expect(KeySchema.safeParse(k).success).toBe(false);
    }
  });
});

describe('role app profiles (H3)', () => {
  it('parse with all sections', () => {
    const t = valid('template') as { roles: { kontrolle: { app: Record<string, unknown> } } };
    const r = TemplateFileSchema.parse(t);
    expect(r.roles?.kontrolle?.app?.shortcuts).toEqual({ kontrolle: {} });
    expect(r.roles?.kontrolle?.app?.presets).toEqual({ neuer_baum: { stage: 'erfasst' } });
  });
  it('rejects an unknown app section', () => {
    const r = parseProjectFile({
      schema: 'ueberblick/1',
      template: { key: 'a', version: '1.0.0' },
      roles: { r: { label: 'R', app: { theme: 'dark' } } },
    });
    expect(r.success).toBe(false);
  });
});

describe('renderer registry (H1)', () => {
  it('lists maplibre-2d', () => expect(RENDERERS.has('maplibre-2d')).toBe(true));
  it('every property type in the schema comes from the registry', () => {
    for (const key of PROPERTY_TYPES.keys) {
      const opts =
        key === 'select' || key === 'multiselect'
          ? { options: { a: 'A' } }
          : key === 'reference'
            ? { to: 'x' }
            : {};
      const r = parseProjectFile({
        schema: 'ueberblick/1',
        template: { key: 'a', version: '1.0.0' },
        types: { t: { label: 'T', properties: { p: { type: key, ...opts } } } },
      });
      expect(r.success, key).toBe(true);
    }
  });
});

describe('GeoJSON with Z (H1)', () => {
  it('validates Z coordinates', () => {
    const geoms = [
      { type: 'Point', coordinates: [1, 2, 3] },
      {
        type: 'LineString',
        coordinates: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      },
      {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0, 1],
            [1, 0, 1],
            [1, 1, 2],
            [0, 0, 1],
          ],
        ],
      },
    ];
    for (const g of geoms) expect(GeoJsonGeometrySchema.safeParse(g).success).toBe(true);
  });
  it('keeps Z through parsing', () => {
    expect(GeoJsonGeometrySchema.parse({ type: 'Point', coordinates: [1, 2, 3] })).toEqual({
      type: 'Point',
      coordinates: [1, 2, 3],
    });
  });
  it('rejects a one-number position and 4D', () => {
    expect(GeoJsonGeometrySchema.safeParse({ type: 'Point', coordinates: [1] }).success).toBe(false);
    expect(GeoJsonGeometrySchema.safeParse({ type: 'Point', coordinates: [1, 2, 3, 4] }).success).toBe(false);
  });
  it('a template with Z defaults validates', () => {
    expect(parseProjectFile(valid('geometry-z')).success).toBe(true);
  });
  it('property: any Point with 2 or 3 finite numbers validates', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), { minLength: 2, maxLength: 3 }),
        (c) => {
          expect(GeoJsonGeometrySchema.safeParse({ type: 'Point', coordinates: c }).success).toBe(true);
        },
      ),
    );
  });
});

describe('personal properties (WP-533)', () => {
  const prop = (personal: unknown): unknown => ({ type: 'text', personal });
  it('accepts the registry subject kinds', () => {
    for (const subject of ['actor', 'feature', 'property:zustaendig']) {
      expect(PropertySchema.safeParse(prop({ subject })).success, subject).toBe(true);
    }
  });
  it('rejects unknown subject kinds and extra keys', () => {
    for (const subject of ['nobody', 'property:', 'property:Bad', 'actor:x', '']) {
      expect(PropertySchema.safeParse(prop({ subject })).success, subject).toBe(false);
    }
    expect(PropertySchema.safeParse(prop({ subject: 'actor', extra: 1 })).success).toBe(false);
    expect(PropertySchema.safeParse(prop({})).success).toBe(false);
  });
  it('has a registry of subject kinds', () => {
    expect(PERSONAL_SUBJECT_KINDS.keys).toEqual(['actor', 'property', 'feature']);
  });
});

describe('standalone ViewSchema (H4)', () => {
  it('validates an ephemeral view', () => {
    expect(ViewSchema.safeParse(valid('view-ephemeral')).success).toBe(true);
  });
  it('rejects an ephemeral view without a source type', () => {
    const negative = parse(
      import.meta.glob('./__fixtures__/invalid/view-no-source-type.yaml', {
        query: '?raw',
        import: 'default',
        eager: true,
      })['./__fixtures__/invalid/view-no-source-type.yaml'] as string,
    );
    const r = ViewSchema.safeParse(negative);
    expect(r.error?.issues[0]?.path.join('.')).toBe('source.type');
  });
});

describe('type process (WP-304)', () => {
  const stage = { type: 'select', options: { neu: 'Neu', fertig: 'Fertig' } };
  const withProcess = (process: unknown) =>
    FeatureTypeSchema.safeParse({ label: 'T', properties: { stage }, process });
  it('accepts a process with property, start and end', () => {
    expect(withProcess({ property: 'stage', start: 'neu', end: ['fertig'] }).success).toBe(true);
  });
  it('is optional', () => {
    expect(FeatureTypeSchema.safeParse({ label: 'T', properties: { stage } }).success).toBe(true);
  });
  it('is strict: unknown keys, a missing start and a non-list end are rejected', () => {
    expect(withProcess({ property: 'stage', start: 'neu', end: ['fertig'], extra: 1 }).success).toBe(false);
    expect(withProcess({ property: 'stage', end: ['fertig'] }).success).toBe(false);
    expect(withProcess({ property: 'stage', start: 'neu', end: 'fertig' }).success).toBe(false);
  });
});
