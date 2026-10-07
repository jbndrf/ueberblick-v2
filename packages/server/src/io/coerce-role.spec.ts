import { describe, expect, it } from 'vitest';
import { coerce } from './coerce';

const roles = {
  kontrolle: { label: { de: 'Kontrolle', en: 'Inspection' } },
  verwaltung: { label: { de: 'Verwaltung' } },
};

describe('CSV import: role cells (WP-459)', () => {
  it('accepts a role key or its label in any language, case-insensitive', () => {
    expect(coerce('role', 'kontrolle', { roles })).toEqual({ ok: true, value: 'kontrolle' });
    expect(coerce('role', 'Kontrolle', { roles })).toEqual({ ok: true, value: 'kontrolle' });
    expect(coerce('role', 'inspection', { roles })).toEqual({ ok: true, value: 'kontrolle' });
  });
  it('refuses an unknown role, as plan does', () => {
    expect(coerce('role', 'Bauhof', { roles })).toEqual({
      ok: false,
      message: "'Bauhof' is not a role of this project",
    });
  });
  it('splits a list with | for cardinality many; one role only otherwise', () => {
    expect(coerce('role', 'Kontrolle|verwaltung', { roles, cardinality: 'many' })).toEqual({
      ok: true,
      value: ['kontrolle', 'verwaltung'],
    });
    expect(coerce('role', 'Kontrolle|verwaltung', { roles })).toMatchObject({ ok: false });
  });
  it('leaves an empty cell out', () => {
    expect(coerce('role', ' ', { roles })).toEqual({ ok: true, value: undefined });
  });
});
