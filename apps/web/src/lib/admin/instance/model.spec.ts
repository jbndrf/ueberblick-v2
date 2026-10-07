import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SLUG, slugOf, slugify, sortOrderOf, withLabelFallbacks } from './model';

describe('slugify (v3 +page.server.ts:5-12)', () => {
  it('lower-cases, drops other characters and joins words with one dash', () => {
    expect(slugify('  Datenschutz & Impressum  ')).toBe('datenschutz-impressum');
    expect(slugify('A -- B')).toBe('a-b');
    expect(slugify('Über uns')).toBe('ueber-uns');
    expect(slugify('Straße & Größe')).toBe('strasse-groesse');
    expect(slugify('Café')).toBe('caf');
  });

  it('property: a non-empty result always fits the API slug alphabet', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const slug = slugify(s);
        if (slug !== '') expect(SLUG.test(slug)).toBe(true);
      }),
    );
  });

  it('takes the title when the slug is empty, the typed slug otherwise', () => {
    expect(slugOf('', 'Mein Impressum')).toBe('mein-impressum');
    expect(slugOf('   ', 'Mein Impressum')).toBe('mein-impressum');
    expect(slugOf('Privacy Policy', 'x')).toBe('privacy-policy');
  });
});

describe('sortOrderOf and label fallbacks', () => {
  it('reads the order like v3 parseInt(...) || 0 and keeps it in the API range', () => {
    expect(sortOrderOf('12')).toBe(12);
    expect(sortOrderOf('')).toBe(0);
    expect(sortOrderOf('-4')).toBe(0);
    expect(sortOrderOf(7.9)).toBe(7);
    expect(sortOrderOf('999999999')).toBe(100_000);
  });

  it('an empty accept or reject label becomes Accept / Reject (v3 :177-178)', () => {
    const s = withLabelFallbacks({
      requireConsent: true,
      consentTitle: ' T ',
      consentBody: '<p>x</p>',
      acceptLabel: ' ',
      rejectLabel: 'Nein',
    });
    expect(s).toMatchObject({ consentTitle: 'T', acceptLabel: 'Accept', rejectLabel: 'Nein' });
  });
});
