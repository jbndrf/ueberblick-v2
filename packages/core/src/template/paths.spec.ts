import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatKeyPath, getAt, parseKeyPath, setAt, touches } from './paths';

describe('key path grammar', () => {
  it('parses bare and bracketed segments', () => {
    expect(parseKeyPath('types.baum.properties.vitalitaet')).toEqual([
      'types',
      'baum',
      'properties',
      'vitalitaet',
    ]);
    expect(parseKeyPath('style["circle-color"]')).toEqual(['style', 'circle-color']);
    expect(parseKeyPath('label["en-GB"].x')).toEqual(['label', 'en-GB', 'x']);
    expect(parseKeyPath('options["0"]')).toEqual(['options', '0']);
    expect(parseKeyPath('["a.b"]')).toEqual(['a.b']);
    expect(parseKeyPath('a["q\\"uote"]')).toEqual(['a', 'q"uote']);
  });

  it('rejects malformed paths', () => {
    for (const bad of [
      '',
      '.a',
      'a.',
      'a..b',
      'A',
      '0a',
      'a.0',
      'a[b]',
      'a["b"',
      'a["b"]c',
      'a[]',
      'a["b"]]',
    ]) {
      expect(parseKeyPath(bad), bad).toBeUndefined();
    }
  });

  it('formats a segment bare only when it is a key', () => {
    expect(formatKeyPath(['style', 'circle-color'])).toBe('style["circle-color"]');
    expect(formatKeyPath(['options', '0'])).toBe('options["0"]');
    expect(formatKeyPath(['a', 'b'])).toBe('a.b');
  });

  it('property: parse(format(segments)) == segments for arbitrary segment strings', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ unit: 'binary' }), { minLength: 1, maxLength: 6 }), (s) => {
        expect(parseKeyPath(formatKeyPath(s))).toEqual(s);
      }),
    );
  });

  it('property: format(parse(p)) == p for canonical paths', () => {
    const seg = fc.oneof(fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/), fc.string({ minLength: 1 }));
    fc.assert(
      fc.property(fc.array(seg, { minLength: 1, maxLength: 5 }), (s) => {
        const p = formatKeyPath(s);
        expect(formatKeyPath(parseKeyPath(p) ?? [])).toBe(p);
      }),
    );
  });

  it('addresses keys that are not bare, and treats lists as atomic', () => {
    const root = { style: { 'circle-color': 'red' }, list: [1, 2] };
    expect(getAt(root, 'style["circle-color"]')).toBe('red');
    expect(setAt(root, 'style["circle-color"]', 'blue')).toBe(true);
    expect(root.style['circle-color']).toBe('blue');
    expect(getAt(root, 'list')).toEqual([1, 2]);
    expect(getAt(root, 'list["0"]')).toBeUndefined();
    expect(setAt(root, 'list["0"]', 9)).toBe(false);
  });

  it('touches compares segments, not text', () => {
    expect(touches('a.b', 'a.b.c')).toBe(true);
    expect(touches('a.b', 'a.bc')).toBe(false);
    expect(touches('a["b"]', 'a.b.c')).toBe(true);
  });
});
