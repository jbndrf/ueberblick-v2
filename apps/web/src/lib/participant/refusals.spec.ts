import { describe, expect, it } from 'vitest';
import { REFUSAL_CODES } from '@ueberblick/core';
import { fieldLabelOf, fieldOfPath, refusalSentenceKey, refusalText } from './refusals';

describe('refusalText', () => {
  it('every registry code has a sentence in de and en, and none shows the code or the developer message', () => {
    for (const code of REFUSAL_CODES.keys) {
      for (const locale of ['de', 'en'] as const) {
        const text = refusalText(locale, { code, message: `dev message ${code}` });
        expect(text.length).toBeGreaterThan(5);
        expect(text).not.toContain(code);
        expect(text).not.toContain('dev message');
        expect(text).not.toContain('(');
      }
    }
  });

  it('uses the v3 sentences verbatim where they fit', () => {
    expect(refusalText('de', { code: 'quota_exceeded', message: 'x' })).toBe(
      'Du hast die maximale Anzahl an Einträgen erreicht.',
    );
    expect(refusalText('de', { code: 'required_missing', message: 'x' })).toBe('Ein Pflichtfeld fehlt.');
    expect(refusalText('de', { code: 'readonly_field', message: 'x' })).toBe(
      'Du darfst dieses Feld nicht ändern.',
    );
    expect(refusalText('en', { code: 'quota_exceeded', message: 'x' })).toBe(
      "You've reached your limit of entries.",
    );
  });

  it('a batch that failed because another run was refused says so (v3 dependent line)', () => {
    expect(refusalText('de', { code: 'batch_failed', message: 'x' })).toBe(
      'Beruht auf einer abgelehnten Änderung.',
    );
    expect(refusalText('en', { code: 'batch_failed', message: 'x' })).toBe('Based on a refused change.');
  });

  it('adds "Feld: {label}" when the refusal names a field the config can label', () => {
    const fieldLabel = (key: string): string | undefined => (key === 'befund' ? 'Befund' : undefined);
    const r = { code: 'required_missing', message: 'x', path: 'form.befund' };
    expect(refusalText('de', r, fieldLabel)).toBe('Ein Pflichtfeld fehlt. Feld: Befund');
    expect(refusalText('en', r, fieldLabel)).toBe('A required field is missing. Field: Befund');
    expect(refusalText('de', { ...r, path: 'form.other' }, fieldLabel)).toBe('Ein Pflichtfeld fehlt.');
    expect(refusalText('de', { ...r, path: 'actor' }, fieldLabel)).toBe('Ein Pflichtfeld fehlt.');
  });

  it('a code the registry does not know (a newer server) gets the general sentence', () => {
    expect(refusalSentenceKey('stale_revision')).toBe('refusal_unknown');
    expect(refusalText('de', { code: 'stale_revision', message: 'x' })).toBe(
      'Die Änderung wurde nicht übernommen.',
    );
  });
});

describe('fieldOfPath', () => {
  it('reads the field key of form., input. and properties. paths', () => {
    expect(fieldOfPath('form.befund')).toBe('befund');
    expect(fieldOfPath('input.befund')).toBe('befund');
    expect(fieldOfPath('properties.befund')).toBe('befund');
    expect(fieldOfPath('rules.x')).toBeUndefined();
    expect(fieldOfPath(undefined)).toBeUndefined();
  });
});

describe('fieldLabelOf', () => {
  const file = {
    tasks: { kontrolle: { form: { befund: { label: { de: 'Befund', en: 'Finding' } }, hoehe: {} } } },
    types: { baum: { properties: { hoehe: { label: { de: 'Höhe', en: 'Height' } } } } },
  } as never;
  it('takes the form label, else the property label, in the person language', () => {
    expect(fieldLabelOf(file, 'en')('kontrolle', 'befund')).toBe('Finding');
    expect(fieldLabelOf(file, 'de')('kontrolle', 'hoehe')).toBe('Höhe');
    expect(fieldLabelOf(file, 'de')('kontrolle', 'nope')).toBeUndefined();
  });
});
