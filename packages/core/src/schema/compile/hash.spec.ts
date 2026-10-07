import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { canonicalJson, contentHash, sha256Hex } from './hash';

describe('sha256Hex', () => {
  it('matches the published test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('handles multi-byte characters and long input', () => {
    expect(sha256Hex('Bäume 🌳')).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex('a'.repeat(1000000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });
});

describe('canonicalJson (RFC 8785)', () => {
  it('reproduces the RFC 8785 section 3.2.3 sample', () => {
    // The RFC input: numbers parsed from their source spelling, the string built from code points.
    const c = (...codes: number[]): string => String.fromCharCode(...codes);
    const bs = c(92);
    const input = {
      numbers: JSON.parse('[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001]') as number[],
      string: `${c(0x20ac)}$${c(0x0f, 0x0a)}A'B${c(0x22, 0x5c, 0x5c, 0x22)}/`,
      literals: [null, true, false],
    };
    const expectedString = `${c(0x20ac)}$${bs}u000f${bs}nA'B${bs}"${bs}${bs}${bs}${bs}${bs}"/`;
    expect(canonicalJson(input)).toBe(
      `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"${expectedString}"}`,
    );
  });
  it('sorts keys by UTF-16 code units, not by locale', () => {
    expect(canonicalJson({ b: 1, a: 2, ä: 3, B: 4 })).toBe('{"B":4,"a":2,"b":1,"ä":3}');
  });
  it('drops undefined members like JSON', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('contentHash', () => {
  it('property: key order never changes the hash', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.jsonValue()), (o) => {
        const reversed = Object.fromEntries(Object.entries(o).reverse());
        expect(contentHash(reversed)).toBe(contentHash(o));
        expect(canonicalJson(reversed)).toBe(canonicalJson(o));
      }),
    );
  });
});
