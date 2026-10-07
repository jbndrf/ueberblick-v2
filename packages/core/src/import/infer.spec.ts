import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMN_TYPES, geometryKeyOf, inferColumnType, surveyFeatureCollection } from './index';

describe('inferColumnType (v3 inferFieldType, onto the v4 property types)', () => {
  it('numbers, numeric strings and booleans', () => {
    expect(inferColumnType([1, 2.5, 3])).toBe('number');
    expect(inferColumnType(['1', '2,5', ' 3 '])).toBe('number');
    expect(inferColumnType([true, false, true])).toBe('boolean');
  });

  it('keeps a code with a leading zero as text (a postcode is not a number)', () => {
    expect(inferColumnType(['01067', '50667'])).toBe('text');
    expect(inferColumnType(['0.5', '10'])).toBe('number');
  });

  it('dates and date-times', () => {
    expect(inferColumnType(['2024-01-31', '2025-12-01'])).toBe('date');
    expect(inferColumnType(['2024-01-31', '2025-12-01T10:30:00Z'])).toBe('datetime');
    expect(inferColumnType(['2024-01-31', 'morgen'])).toBe('text');
  });

  it('strings: short text, long text above 120 characters', () => {
    expect(inferColumnType(['Eiche', 'Linde'])).toBe('text');
    expect(inferColumnType(['Eiche', 'x'.repeat(121)])).toBe('long_text');
  });

  it('empty, null and missing values are ignored; no value at all is text', () => {
    expect(inferColumnType([])).toBe('text');
    expect(inferColumnType([null, undefined, ''])).toBe('text');
    expect(inferColumnType([null, 4, undefined, ''])).toBe('number');
  });

  it('mixed scalars are text, structured values are long text (kept verbatim)', () => {
    expect(inferColumnType([1, 'a'])).toBe('text');
    expect(inferColumnType([true, 1])).toBe('text');
    expect(inferColumnType([{ a: 1 }, 'x'])).toBe('long_text');
    expect(inferColumnType([[1, 2]])).toBe('long_text');
  });

  it('property: always a registered column type, and null padding never changes the result', () => {
    const value = fc.oneof(
      fc.string(),
      fc.double({ noNaN: true }),
      fc.boolean(),
      fc.constant(null),
      fc.constantFrom('2024-05-01', '2024-05-01T10:00:00Z'),
      fc.array(fc.integer(), { maxLength: 2 }),
    );
    fc.assert(
      fc.property(fc.array(value, { maxLength: 12 }), (values) => {
        const t = inferColumnType(values);
        expect(IMPORT_COLUMN_TYPES.has(t)).toBe(true);
        expect(inferColumnType([null, ...values, undefined, ''])).toBe(t);
      }),
    );
  });

  it('property: a list of finite numbers is number, of booleans boolean', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ noNaN: true, noDefaultInfinity: true }), { minLength: 1 }), (ns) => {
        expect(inferColumnType(ns)).toBe('number');
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: 1 }), (bs) => {
        expect(inferColumnType(bs)).toBe('boolean');
      }),
    );
  });
});

describe('surveyFeatureCollection', () => {
  const point = { type: 'Point', coordinates: [7, 50] };
  const line = {
    type: 'LineString',
    coordinates: [
      [7, 50],
      [7.1, 50.1],
    ],
  };

  it('counts the features, lists the geometry kinds and one column per property key', () => {
    const r = surveyFeatureCollection({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: point, properties: { art: 'Eiche', hoehe: 12 } },
        { type: 'Feature', geometry: point, properties: { art: 'Linde', hoehe: 8.5, alt: true } },
        { type: 'Feature', geometry: null, properties: null },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.survey.featureCount).toBe(3);
    expect(r.survey.geometryKinds).toEqual(['Point']);
    expect(r.survey.columns).toEqual([
      { name: 'art', inferred: 'text' },
      { name: 'hoehe', inferred: 'number' },
      { name: 'alt', inferred: 'boolean' },
    ]);
  });

  it('a file that is not a FeatureCollection is refused; so is one without features', () => {
    for (const bad of [null, 5, 'x', [], {}, { type: 'Feature' }, { type: 'FeatureCollection' }]) {
      expect(surveyFeatureCollection(bad)).toEqual({ ok: false, reason: 'not_feature_collection' });
    }
    expect(surveyFeatureCollection({ type: 'FeatureCollection', features: [] })).toEqual({
      ok: false,
      reason: 'no_features',
    });
  });

  it('geometryKeyOf: one kind keeps it, several are any, none is null', () => {
    expect(geometryKeyOf(['Point'])).toBe('point');
    expect(geometryKeyOf(['MultiPolygon'])).toBe('multipolygon');
    expect(geometryKeyOf(['Point', 'LineString'])).toBe('any');
    expect(geometryKeyOf(['GeometryCollection'])).toBe('any');
    expect(geometryKeyOf([])).toBeNull();
    const r = surveyFeatureCollection({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: point, properties: {} },
        { type: 'Feature', geometry: line, properties: {} },
      ],
    });
    expect(r.ok && r.survey.geometryKinds).toEqual(['Point', 'LineString']);
  });
});
