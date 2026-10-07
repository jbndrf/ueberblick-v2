import { describe, expect, it } from 'vitest';
import type { Key } from '../model';
import { FormConfigError, formApi } from './index';
import { ctx, world } from './__fixtures__';

const config = world();
const c = () => ctx(config, {});
const state = (e: ReturnType<typeof formApi.evaluate>, key: string) => {
  const f = e.fields.find((x) => x.key === key);
  if (!f) throw new Error(key);
  return f;
};

describe('readonly calculated fields: dependency order', () => {
  it('a readonly field reading a later readonly field sees its computed value', () => {
    const e = formApi.evaluate('kette' as Key, config, { p_c: 3 }, c());
    expect(state(e, 'p_b').value).toBe(6);
    expect(state(e, 'p_a').value).toBe(7);
    expect(formApi.submitValues(e)).toMatchObject({ p_a: 7, p_b: 6, p_c: 3 });
  });

  it('a cycle among readonly calculated fields is a FormConfigError', () => {
    expect(() => formApi.evaluate('zyklus' as Key, config, {}, c())).toThrow(FormConfigError);
    expect(() => formApi.dependents('zyklus' as Key, config, 'p_a' as Key)).toThrow(FormConfigError);
  });
});

describe('expression errors are reported in errors[]', () => {
  const e = formApi.evaluate('fehler' as Key, config, {}, c());
  it('required', () => {
    expect(state(e, 'p_a').required).toBe(false);
    expect(state(e, 'p_a').errors.map((x) => x.attr)).toEqual(['required']);
  });
  it('readonly (counts as false)', () => {
    expect(state(e, 'p_b').readonly).toBe(false);
    expect(state(e, 'p_b').errors.map((x) => x.attr)).toEqual(['readonly']);
  });
  it('calculate (no value)', () => {
    expect(state(e, 'p_c').value).toBeUndefined();
    expect(state(e, 'p_c').errors.map((x) => x.attr)).toEqual(['calculate']);
  });
});

describe('a supplied readonly value is compared canonically', () => {
  it('object key order does not matter', () => {
    const same = { type: 'Point', coordinates: [1, 2] };
    const reordered = { coordinates: [1, 2], type: 'Point' };
    expect(formApi.evaluate('objekt' as Key, config, { meta: same }, c()).valid).toBe(true);
    expect(formApi.evaluate('objekt' as Key, config, { meta: reordered }, c()).valid).toBe(true);
    const other = { type: 'Point', coordinates: [1, 3] };
    expect(formApi.evaluate('objekt' as Key, config, { meta: other }, c()).valid).toBe(false);
  });
});
