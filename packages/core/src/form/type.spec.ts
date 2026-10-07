import { describe, expect, it } from 'vitest';
import type { Json, Key } from '../model';
import { FormConfigError, formApi } from './index';
import { typeFits } from './type';
import type { FormValues } from './contract';
import { ctx, world } from './__fixtures__';

const config = world();
const c = () => ctx(config, {});
const T = 'typen' as Key;
const tv = (values: FormValues) => formApi.evaluate(T, config, values, c());
const issues = (key: string, value: Json) =>
  tv({ [key]: value })
    .fields.find((f) => f.key === key)
    ?.issues.map((i) => i.issue);
const bad = (key: string, value: Json) => expect(issues(key, value)).toEqual(['type']);
const good = (key: string, value: Json) => expect(issues(key, value)).toEqual([]);

describe('type issue', () => {
  it('checks the value against the property type', () => {
    bad('hoehe_m', 'x');
    bad('hoehe_m', Number.POSITIVE_INFINITY);
    good('hoehe_m', 3.5);
    bad('stamm', 2.5);
    bad('offen', 'true');
    good('offen', false);
    bad('am', '29.09.2026');
    good('am', '2026-09-29');
    bad('wann', 'gestern');
    good('wann', '2026-09-29T12:00:00Z');
    bad('titel', 'plain');
    good('titel', { de: 'a', en: 'b' });
    bad('anhang', 'sha');
    bad('anhang', { sha256: 'bb22', name: 'a.jpg', mime: 'image/jpeg' });
    good('anhang', [{ sha256: 'bb22', name: 'a.jpg', mime: 'image/jpeg' }]);
    bad('geom', { x: 1 });
    good('geom', { type: 'Point', coordinates: [1, 2] });
    bad('geom', {
      type: 'LineString',
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    });
  });

  it('select and multiselect values must be declared options', () => {
    good('art', 'eiche');
    bad('art', 'buche');
    bad('art', ['eiche']);
    good('arten', ['eiche', 'linde']);
    bad('arten', ['eiche', 'buche']);
    bad('arten', 'eiche');
  });

  it('min and max of a number are type issues', () => {
    good('stamm', 1);
    good('stamm', 9);
    bad('stamm', 0);
    bad('stamm', 10);
  });

  it('a type failure skips the constraint; empty values are not type-checked', () => {
    const e = formApi.evaluate(
      'kontrolle' as Key,
      config,
      { vitalitaet: 'v2', befund: 'n', hoehe_m: 'x' },
      c(),
    );
    expect(e.fields.find((f) => f.key === 'hoehe_m')?.issues.map((i) => i.issue)).toEqual(['type']);
    expect(issues('hoehe_m', null)).toEqual([]);
  });

  it('the target type: on, creates, or the type argument for several types', () => {
    const neu = formApi.evaluate('neu' as Key, config, { name: 5 }, c());
    expect(neu.fields[0]?.issues[0]?.issue).toBe('type');
    expect(() => formApi.evaluate('zwei' as Key, config, {}, c())).toThrow(FormConfigError);
    const z = formApi.evaluate('zwei' as Key, config, { name: 5 }, c(), 'flaeche' as Key);
    expect(z.fields[0]?.issues[0]?.issue).toBe('type');
  });
});

describe('cardinality many on participant and reference (WP-443)', () => {
  const prop = (type: 'participant' | 'reference', cardinality?: 'many') =>
    ({
      type,
      ...(type === 'reference' ? { to: 'x' } : {}),
      ...(cardinality ? { cardinality } : {}),
    }) as never;
  it('one: a string; many: a list of strings', () => {
    for (const t of ['participant', 'reference'] as const) {
      expect(typeFits(prop(t), 'a')).toBe(true);
      expect(typeFits(prop(t), ['a'])).toBe(false);
      expect(typeFits(prop(t, 'many'), ['a', 'b'])).toBe(true);
      expect(typeFits(prop(t, 'many'), 'a')).toBe(false);
      expect(typeFits(prop(t, 'many'), [1])).toBe(false);
    }
  });
});
