import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Json, Key } from '../model';
import { PROPERTY_TYPES } from '../registry';
import type { PropertyTypeKey } from '../registry';
import { formApi } from './index';
import { isEmptyValue } from './empty';
import { FILE, ctx, world } from './__fixtures__';

// b is relevant when a == 'x', c is relevant when b == 'y' (reads b, which may be dropped).
const file = {
  ...FILE,
  types: {
    ...FILE.types,
    baum: {
      ...FILE.types.baum,
      permissions: { write: { geom: ['kontrolle'], titel: ['kontrolle'] } },
    },
  },
  tasks: {
    kaskade: {
      label: { de: 'K' },
      on: 'baum',
      form: {
        // declared out of dependency order on purpose: the reader of a dropped field comes first
        notiz: { relevant: "form.befund == 'y'", required: true },
        befund: { relevant: "form.vitalitaet == 'x'" },
        vitalitaet: {},
        grund: { required: 'has(form.notiz)' },
      },
    },
    geo: {
      label: { de: 'G' },
      on: '$map',
      creates: 'baum',
      form: { geom: { required: true }, titel: { required: true } },
    },
  },
};
const config = world(file);
const K = 'kaskade' as Key;
const ev = (v: Record<string, Json>) => formApi.evaluate(K, config, v, ctx(config));
const rel = (v: Record<string, Json>, f: string) => ev(v).fields.find((x) => x.key === f)?.relevant;

describe('DIV-3: relevance cascade (dropped fields read as empty)', () => {
  // vitalitaet -> befund (relevant when vitalitaet == x) -> notiz (relevant when befund == y) -> grund
  it('a field reading a non-relevant field sees it as empty', () => {
    expect(rel({ vitalitaet: 'z', befund: 'y' }, 'befund')).toBe(false);
    expect(rel({ vitalitaet: 'z', befund: 'y' }, 'notiz')).toBe(false);
    expect(rel({ vitalitaet: 'x', befund: 'y' }, 'notiz')).toBe(true);
  });
  it('the dropped value does not leak into submitValues or issues', () => {
    const e = ev({ vitalitaet: 'z', befund: 'y', notiz: 'v' });
    expect(formApi.submitValues(e)).toEqual({ vitalitaet: 'z' });
    expect(e.valid).toBe(true);
  });
  it('dependents follows the cascade through relevance', () => {
    expect(formApi.dependents(K, config, 'vitalitaet' as Key)).toEqual([
      'notiz',
      'befund',
      'vitalitaet',
      'grund',
    ]);
  });
  it('property: outside dependents() a field keeps its state (cascade included)', () => {
    const names = ['vitalitaet', 'befund', 'notiz', 'grund'];
    const scalar = fc.constantFrom<Json | undefined>(undefined, 'x', 'y', 'z', '');
    const vals = fc.record(
      { vitalitaet: scalar, befund: scalar, notiz: scalar, grund: scalar },
      { requiredKeys: [] },
    );
    const clean = (v: Record<string, Json | undefined>): Record<string, Json> =>
      Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Record<string, Json>;
    fc.assert(
      fc.property(vals, fc.constantFrom(...names), scalar, (v, changed, next) => {
        const inside = new Set(formApi.dependents(K, config, changed as Key));
        const a = ev(clean(v));
        const b = ev(clean({ ...v, [changed]: next }));
        for (const f of names)
          if (!inside.has(f as Key))
            expect(b.fields.find((x) => x.key === f)).toEqual(a.fields.find((x) => x.key === f));
      }),
      { numRuns: 300 },
    );
  });
});

describe('DIV-2: one emptiness definition', () => {
  const SAMPLE: Record<PropertyTypeKey, { empty: Json[]; filled: Json }> = {
    text: { empty: ['', null], filled: 'a' },
    localized_text: { empty: [{}, { de: '' }, { de: '', en: '' }], filled: { de: 'a' } },
    number: { empty: [null], filled: 0 },
    integer: { empty: [null], filled: 0 },
    boolean: { empty: [null], filled: false },
    date: { empty: [''], filled: '2026-01-01' },
    datetime: { empty: [''], filled: '2026-01-01T00:00:00Z' },
    time: { empty: [''], filled: '14:30' },
    select: { empty: [''], filled: 'a' },
    multiselect: { empty: [[]], filled: ['a'] },
    geometry: { empty: [null], filled: { type: 'Point', coordinates: [1, 2] } },
    participant: { empty: [''], filled: 'u' },
    role: { empty: [''], filled: 'r' },
    reference: { empty: [''], filled: 'f' },
    file: { empty: [null], filled: [{ sha256: 'abc', name: 'a.png', mime: 'image/png' }] },
  };
  it('property: every registered property type has empty and filled samples that classify correctly', () => {
    for (const key of PROPERTY_TYPES.keys as readonly PropertyTypeKey[]) {
      const s = SAMPLE[key];
      expect(s, key).toBeDefined();
      for (const e of s.empty) expect(isEmptyValue(e), `${key} ${JSON.stringify(e)}`).toBe(true);
      expect(isEmptyValue(s.filled), key).toBe(false);
    }
    expect(isEmptyValue(undefined)).toBe(true);
  });
  it('form `required` treats an empty LocalizedString as missing', () => {
    const e = formApi.evaluate(
      'geo' as Key,
      config,
      { titel: {}, geom: { type: 'Point', coordinates: [1, 2] } },
      ctx(config),
    );
    expect(e.fields.find((f) => f.key === 'titel')?.issues.map((i) => i.issue)).toEqual(['required']);
  });
  it('exposes the property type of a field so plan can tell geometry_required', () => {
    const e = formApi.evaluate('geo' as Key, config, {}, ctx(config));
    expect(e.fields.map((f) => f.propertyType)).toEqual(['geometry', 'localized_text']);
  });
});
