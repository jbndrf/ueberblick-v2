// WP-637: the `time` property type (wall-clock time of day, "HH:MM", no date, no zone; as v3's time mode).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BUILTIN_FUNCTIONS, check } from '../expr/check';
import { evaluate } from '../expr/evaluate';
import { parse } from '../expr/parse';
import type { Json } from '../model';
import { PROPERTY_TYPES } from '../registry';
import { propertyTy } from '../schema/compile/env';
import type { Property } from '../schema/property';
import { typeFits } from './type';

const time: Property = { type: 'time' } as Property;
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

describe('time values', () => {
  it('is a registry property type', () => {
    expect(PROPERTY_TYPES.has('time')).toBe(true);
  });

  it('accepts every HH:MM of the day (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }), (h, m) =>
        typeFits(time, `${pad(h)}:${pad(m)}`),
      ),
    );
  });

  it('refuses everything else (property)', () => {
    const valid = /^([01]\d|2[0-3]):[0-5]\d$/;
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.integer(), fc.constant(null as Json)), (v) =>
        valid.test(String(v)) && typeof v === 'string' ? true : !typeFits(time, v as Json),
      ),
    );
  });

  it.each(['24:00', '12:60', '9:30', '12:30:00', '12:30Z', '2026-05-01T12:30', '', 'noon'])(
    'refuses %s',
    (v) => {
      expect(typeFits(time, v)).toBe(false);
    },
  );
});

describe('time in the rule language', () => {
  it('is a string, so times order and compare as text', () => {
    expect(propertyTy(time)).toEqual({ kind: 'string' });
    const env = { features: {}, forms: {}, properties: {} } as unknown as Parameters<typeof check>[1];
    const p = parse("'09:00' < '14:30' && '14:30' <= '14:30'");
    if (!p.ok) throw new Error('parse');
    const c = check(p.ast, env);
    expect(BUILTIN_FUNCTIONS).toBeDefined();
    if (!c.ok) throw new Error(c.errors.map((e) => e.message).join());
    const r = evaluate(c.typed, { now: '2026-01-01T00:00:00.000Z' } as never);
    expect(r).toEqual({ ok: true, value: true });
  });
});
