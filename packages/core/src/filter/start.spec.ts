// WP-397 (A-040): types.<t>.on_at_start / values_at_start: schema, compile problems, and the participant's start state.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile } from '../schema/compile';
import { TemplateFileSchema, type TemplateFile } from '../schema/file';
import { goldenConfig } from '../testing';
import { startFilter } from './start';

const base = (type: Record<string, unknown> = {}): Record<string, unknown> => {
  const f = parse(`
schema: ueberblick/1
template: { key: t, version: 1.0.0 }
roles: { r: { label: R, app: { home: karte, views: { karte: {} } } } }
types:
  baum:
    label: Baum
    geometry: standort
    properties:
      standort: { type: geometry, geometry_type: point }
      stage: { type: select, options: { a: A, b: B, c: C } }
      vit: { type: select, options: { v0: '0', v1: '1' } }
      name: { type: text }
    process: { property: stage, start: a, end: [c] }
  bank:
    label: Bank
    geometry: standort
    properties:
      standort: { type: geometry, geometry_type: point }
views: { karte: { source: { type: baum } } }
`) as { types: { baum: Record<string, unknown> } };
  Object.assign(f.types.baum, type);
  return f;
};
const file = (type?: Record<string, unknown>): TemplateFile => TemplateFileSchema.parse(base(type));
const codes = (type: Record<string, unknown>): string[] => {
  const r = compile(file(type), { assets: () => undefined });
  return r.ok ? [] : r.problems.map((p) => p.code);
};

describe('schema and compile', () => {
  it('parses both keys and compiles them', () => {
    const f = file({ on_at_start: false, values_at_start: ['a', 'b'] });
    expect(f.types?.baum?.on_at_start).toBe(false);
    expect(f.types?.baum?.values_at_start).toEqual(['a', 'b']);
    expect(codes({ on_at_start: false, values_at_start: ['a', 'b'] })).toEqual([]);
  });
  it('refuses a wrong type', () => {
    expect(TemplateFileSchema.safeParse(base({ on_at_start: 'no' })).success).toBe(false);
    expect(TemplateFileSchema.safeParse(base({ values_at_start: 'a' })).success).toBe(false);
  });
  it('a value that is not an option gives start_value_unknown, at the entry', () => {
    const r = compile(file({ values_at_start: ['a', 'zz'] }), { assets: () => undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const p = r.problems.find((x) => x.code === 'start_value_unknown');
      expect(p?.path).toContain('values_at_start');
    }
  });
  it('the classifying property wins over the stage', () => {
    const ok = { classify: { property: 'vit', values: {} }, values_at_start: ['v1'] };
    expect(codes(ok)).toEqual([]);
    expect(codes({ ...ok, values_at_start: ['a'] })).toContain('start_value_unknown');
  });
  it('values_at_start on a type with no classifying property gives start_values_without_property', () => {
    const f = base();
    Object.assign((f.types as Record<string, Record<string, unknown>>)['bank'] ?? {}, {
      values_at_start: ['a'],
    });
    const r = compile(TemplateFileSchema.parse(f), { assets: () => undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.map((p) => p.code)).toContain('start_values_without_property');
  });
});

describe('startFilter', () => {
  it('a type off: the type and all its values are hidden', () => {
    const s = startFilter(file({ on_at_start: false }));
    expect([...s.hiddenTypes]).toEqual(['baum']);
    expect([...(s.hiddenValues.get('baum' as never) ?? [])].sort()).toEqual(['a', 'b', 'c']);
  });
  it('values_at_start hides the other values, and the type stays on', () => {
    const s = startFilter(file({ values_at_start: ['a', 'b'] }));
    expect(s.hiddenTypes.size).toBe(0);
    expect([...(s.hiddenValues.get('baum' as never) ?? [])]).toEqual(['c']);
  });
  it('no value on hides the type as the filter does', () => {
    const s = startFilter(file({ values_at_start: [] }));
    expect([...s.hiddenTypes]).toEqual(['baum']);
  });
  it('all values listed hides nothing', () => {
    const s = startFilter(file({ values_at_start: ['a', 'b', 'c'] }));
    expect(s.hiddenValues.size).toBe(0);
  });
  it('a golden template without the keys starts all on', () => {
    const s = startFilter(goldenConfig('templates/baumkataster/1.0.0.yaml').file);
    expect(s.hiddenTypes.size + s.hiddenValues.size).toBe(0);
  });
  it('property: with no keys set the start state is empty; a hidden value is never a listed one', () => {
    fc.assert(
      fc.property(fc.subarray(['a', 'b', 'c']), fc.option(fc.boolean(), { nil: undefined }), (list, on) => {
        expect(startFilter(file()).hiddenTypes.size).toBe(0);
        const s = startFilter(file({ values_at_start: list, ...(on !== undefined && { on_at_start: on }) }));
        const hidden = s.hiddenValues.get('baum' as never) ?? new Set<string>();
        if (on !== false) for (const v of list) expect(hidden.has(v)).toBe(false);
        expect(s.hiddenTypes.has('baum' as never)).toBe(on === false || list.length === 0);
      }),
    );
  });
});
