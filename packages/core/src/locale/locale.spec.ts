import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { acceptLocales, localize, localizeExact } from './index';

const tag = fc.constantFrom('de', 'en', 'fr', 'de-AT', 'en-GB');
const text = fc.string({ minLength: 1 });
const map = fc.dictionary(tag, text, { minKeys: 1 });

describe('localize', () => {
  it('prefers the requested locales in order', () => {
    expect(localize({ de: 'Baum', en: 'Tree' }, ['en', 'de'])).toBe('Tree');
    expect(localize({ de: 'Baum', en: 'Tree' }, ['fr', 'de'])).toBe('Baum');
  });
  it('tries the exact tag, then its base language', () => {
    expect(localize({ de: 'Baum', 'de-AT': 'Bam' }, ['de-AT'])).toBe('Bam');
    expect(localize({ de: 'Baum', en: 'Tree' }, ['en-GB'])).toBe('Tree');
  });
  it('falls back to the first key, and a caller default appended to locales wins over it', () => {
    expect(localize({ fr: 'Arbre', en: 'Tree' }, ['de'])).toBe('Arbre');
    expect(localize({ fr: 'Arbre', en: 'Tree' }, ['de', 'en'])).toBe('Tree');
    expect(localize({ fr: 'Arbre' }, [])).toBe('Arbre');
  });
  it('returns a plain string as is and "" for nothing', () => {
    expect(localize('Baum', ['en'])).toBe('Baum');
    expect(localize(undefined, ['en'])).toBe('');
  });
  it('property: never undefined for a non-empty value; requested locale beats everything else', () => {
    fc.assert(
      fc.property(map, fc.array(tag, { maxLength: 4 }), (m, locales) => {
        const out = localize(m, locales);
        expect(typeof out).toBe('string');
        expect(Object.values(m)).toContain(out);
        const entry = (l: string): string | undefined => m[l] ?? m[l.split('-')[0] ?? l];
        const first = locales.find((l) => entry(l) !== undefined);
        if (first !== undefined) expect(out).toBe(entry(first));
        if (locales.length === 0) expect(out).toBe(Object.values(m)[0]);
      }),
    );
  });
});

describe('localizeExact', () => {
  it('never shows another language: an English field never shows German text', () => {
    expect(localizeExact({ de: 'Baum' }, 'en')).toBe('');
    expect(localizeExact({ de: 'Baum', en: 'Tree' }, 'en-GB')).toBe('Tree');
    expect(localizeExact('Baum', 'en')).toBe('Baum');
    expect(localizeExact(undefined, 'en')).toBe('');
  });
  it('property: equals the exact entry or ""', () => {
    fc.assert(
      fc.property(map, tag, (m, l) => {
        const out = localizeExact(m, l);
        expect(out === '' || Object.values(m).includes(out)).toBe(true);
        if (m[l] !== undefined) expect(out).toBe(m[l]);
      }),
    );
  });
});

describe('acceptLocales', () => {
  it('orders by q then position and drops * and q=0', () => {
    expect(acceptLocales('de;q=0.5, en-GB, fr;q=0.9, *;q=0.1, it;q=0')).toEqual(['en-GB', 'fr', 'de']);
    expect(acceptLocales(null)).toEqual([]);
    expect(acceptLocales('')).toEqual([]);
  });
});
