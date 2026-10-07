import { describe, expect, it } from 'vitest';
import { parseMappings } from './mappings';

describe('parseMappings', () => {
  it('accepts a target key or a discard and nothing else', () => {
    expect(parseMappings(undefined)).toEqual({});
    expect(parseMappings({ a: { to: 'b' }, c: { discard: true } })).toEqual({
      a: { to: 'b' },
      c: { discard: true },
    });
    for (const v of [{ a: {} }, { a: { to: '' } }, { a: { discard: false } }, { a: 'b' }, [], 3])
      expect(parseMappings(v)).toBeUndefined();
  });
});
