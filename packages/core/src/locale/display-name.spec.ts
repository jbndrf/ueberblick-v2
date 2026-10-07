import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { FeatureType } from '../schema';
import { displayName, shortId } from './index';

const type = {
  label: { de: 'Meldung', en: 'Report' },
  properties: {
    geometrie: { type: 'geometry' },
    kategorie: { type: 'select', options: { a: 'A' } },
    beschreibung: { type: 'localized_text', required: true },
    titel: { type: 'text', required: true },
    befund: { type: 'text' },
  },
} as unknown as FeatureType;

const noName = {
  label: { de: 'Einsatz', en: 'Work order' },
  properties: { status: { type: 'select', options: { a: 'A' } }, notiz: { type: 'text' } },
} as unknown as FeatureType;

describe('displayName', () => {
  it('is the first required text or localized text with a value, in the order the type declares', () => {
    const f = { id: 'f-1', properties: { beschreibung: { de: 'Loch', en: 'Hole' }, titel: 'Zweiter' } };
    expect(displayName(type, f, ['de'])).toBe('Loch');
    expect(displayName(type, f, ['en'])).toBe('Hole');
    expect(
      displayName(type, { id: 'f-1', properties: { beschreibung: '  ', titel: 'Zweiter' } }, ['de']),
    ).toBe('Zweiter');
  });

  it('never uses an optional text property: a finding or a note is not a name', () => {
    const f = { id: 'f-1234', properties: { befund: 'Riss im Stamm', beschreibung: '', titel: '' } };
    expect(displayName(type, f, ['de'])).toBe('Meldung #1234');
  });

  it('falls back to the type label and a short id when no text is set', () => {
    const f = { id: 'abcdefgh-1234', properties: { status: 'a', notiz: 'optional' } };
    expect(displayName(noName, f, ['de'])).toBe(`Einsatz ${shortId(f.id)}`);
    expect(displayName(noName, f, ['en'])).toBe(`Work order ${shortId(f.id)}`);
    expect(shortId(f.id)).toBe('#1234');
  });

  it('is the id for a type the file does not declare', () => {
    expect(displayName(undefined, { id: 'x', properties: {} }, ['de'])).toBe('x');
  });

  it('is never empty', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string(), (id, text) => {
        expect(displayName(type, { id, properties: { titel: text } }, ['de']).length).toBeGreaterThan(0);
      }),
    );
  });
});

describe('displayName with a reference Anzeigefeld (A-048)', () => {
  const f = { id: 'f-1234', properties: { befund: 'Riss im Stamm', titel: 'Linde 4' } };
  it('shows the chosen property of the target, even an optional one', () => {
    expect(displayName(type, f, ['de'], { display_property: 'befund' })).toBe('Riss im Stamm');
  });
  it('falls back to the display name when the chosen property is empty or no one is chosen', () => {
    expect(displayName(type, f, ['de'], { display_property: 'kategorie' })).toBe('Linde 4');
    expect(displayName(type, f, ['de'], {})).toBe('Linde 4');
    expect(displayName(type, f, ['de'])).toBe('Linde 4');
  });
});
