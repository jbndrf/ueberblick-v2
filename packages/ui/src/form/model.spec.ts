import { describe, expect, it } from 'vitest';
import { PROPERTY_TYPES } from '@ueberblick/core/registry';
import { type Property } from '@ueberblick/core/model';
import { buildFormModel, INPUT_KIND_BY_TYPE } from './model';
import { FormModelError } from './contract';

const P = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra }) as unknown as Property;

describe('buildFormModel', () => {
  it('has an input kind for every property type in the registry', () => {
    for (const key of PROPERTY_TYPES.keys) expect(INPUT_KIND_BY_TYPE[key], key).toBeTruthy();
  });

  it('builds a field per type with the right input', () => {
    const properties = {
      t: P('text'),
      n: P('number', { min: 1 }),
      s: P('select', { options: { a: 'A' } }),
      d: P('date'),
      p: P('participant'),
      f: P('file'),
      g: P('geometry'),
    };
    const m = buildFormModel({
      form: Object.fromEntries(Object.keys(properties).map((k) => [k, {}])),
      properties,
    });
    expect(m.fields.map((f) => f.input)).toEqual([
      'text',
      'number',
      'select',
      'date',
      'choice',
      'tool',
      'tool',
    ]);
    expect(m.fields[1]?.min).toBe(1);
  });

  it('a localized_text property gets its own input, not the plain text one', () => {
    const m = buildFormModel({ form: { l: {} }, properties: { l: P('localized_text') } });
    expect(m.fields[0]?.input).toBe('localized_text');
  });

  it('an unknown property type is a typed error, not a blank', () => {
    const build = () => buildFormModel({ form: { x: {} }, properties: { x: P('hologram') } });
    expect(build).toThrow(FormModelError);
    try {
      build();
    } catch (e) {
      expect((e as FormModelError).code).toBe('unknown_property_type');
      expect((e as FormModelError).fieldKey).toBe('x');
    }
  });

  it('a form field without a property is a typed error', () => {
    try {
      buildFormModel({ form: { y: {} }, properties: {} });
      expect.unreachable();
    } catch (e) {
      expect((e as FormModelError).code).toBe('unknown_property');
    }
  });

  it('form label overrides the property label; tool and appearance carry over', () => {
    const m = buildFormModel({
      form: { a: { label: 'Form', tool: 'photo', appearance: 'multiline  email' } },
      properties: { a: P('file', { label: 'Prop' }) },
    });
    expect(m.fields[0]).toMatchObject({ label: 'Form', tool: 'photo', appearance: ['multiline', 'email'] });
  });

  it('a field with `page` starts a new page at that field; no `page` means one page', () => {
    const properties = { a: P('text'), b: P('text'), c: P('text') };
    const one = buildFormModel({ form: { a: {}, b: {}, c: {} }, properties });
    expect(one.pages).toHaveLength(1);
    const three = buildFormModel({
      form: { a: {}, b: { page: {} }, c: { page: {} } },
      properties,
    });
    expect(three.pages.map((p) => p.map((f) => f.key))).toEqual([['a'], ['b'], ['c']]);
  });
  it('carries no form expressions; core.form owns them', () => {
    const m = buildFormModel({
      form: { b: { required: true, relevant: 'true' } },
      properties: { b: P('text') },
    });
    expect(Object.keys(m.fields[0] ?? {})).not.toContain('relevant');
    expect(Object.keys(m.fields[0] ?? {})).not.toContain('required');
  });

  // WP-697: v3 never showed the geometry as a form row (a system field that projects onto the case, state.svelte.ts:465,
  // placed by the map step and carried as the run's `geometry`, task-run.ts:526-540).
  describe('a geometry placed on the map', () => {
    const properties = { t: P('text'), g: P('geometry') };
    const form = { t: {}, g: { required: true } };
    const point = { type: 'Point', coordinates: [7, 50] };

    it('is no row of the form (in no page either)', () => {
      const m = buildFormModel({ form, properties, placed: { g: point } });
      expect(m.fields.map((f) => f.key)).toEqual(['t']);
      expect(m.pages.flat().map((f) => f.key)).toEqual(['t']);
    });

    it('stays a row while nothing placed it: the form is then where the person sets it', () => {
      expect(buildFormModel({ form, properties }).fields.map((f) => f.key)).toEqual(['t', 'g']);
      expect(buildFormModel({ form, properties, placed: {} }).fields.map((f) => f.key)).toEqual(['t', 'g']);
    });

    it('only geometry properties are hidden, whatever else the map step handed in', () => {
      const m = buildFormModel({ form, properties, placed: { t: 'x', g: point } });
      expect(m.fields.map((f) => f.key)).toEqual(['t']);
    });
  });
});
