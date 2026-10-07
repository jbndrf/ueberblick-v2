import { describe, expect, it } from 'vitest';
import { datetimeToSave, instantToLocalInput, localInputToInstant } from './datetime-input';

describe('datetime template input', () => {
  it('a zoned ISO value shows non-empty and saves back as the same instant', () => {
    const stored = '2026-05-04T10:30:00+02:00';
    const shown = instantToLocalInput(stored);
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(Date.parse(localInputToInstant(shown) ?? '')).toBe(Date.parse(stored));
  });

  it('an untouched save keeps the stored value, seconds and offset included', () => {
    const stored = '2026-05-04T10:30:45+02:00';
    expect(datetimeToSave(stored, instantToLocalInput(stored))).toBe(stored);
  });

  it('an edit saves the new local time as an instant; empty clears; junk is null', () => {
    const stored = '2026-05-04T10:30:00Z';
    expect(datetimeToSave(stored, '2026-06-01T08:15')).toBe(new Date('2026-06-01T08:15').toISOString());
    expect(datetimeToSave(stored, '')).toBe('');
    expect(localInputToInstant('nope')).toBeNull();
    expect(instantToLocalInput(undefined)).toBe('');
    expect(instantToLocalInput('nope')).toBe('');
  });
});
