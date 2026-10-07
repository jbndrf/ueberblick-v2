import { describe, expect, it } from 'vitest';
import { formatValue, previewColumns, problemKey } from './problems';

describe('problemKey: the dry run speaks codes, the wizard says them in the admin tone', () => {
  it('knows the import codes and leaves a refusal code to its own message', () => {
    expect(problemKey('geometry_invalid')).toBe('import_problem_geometry_invalid');
    expect(problemKey('crs_undeclared')).toBe('import_problem_crs_undeclared');
    expect(problemKey('required')).toBeNull();
  });
});

describe('formatValue: a preview cell', () => {
  it('shows text, numbers and booleans plainly, a point as lon, lat, empty as empty', () => {
    expect(formatValue('Eiche')).toBe('Eiche');
    expect(formatValue(12.5)).toBe('12.5');
    expect(formatValue(true)).toBe('Ja');
    expect(formatValue(false)).toBe('Nein');
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
    expect(formatValue({ type: 'Point', coordinates: [7.123456789, 50.1] })).toBe('7.12346, 50.10000');
    expect(formatValue({ de: 'Hallo' })).toBe('{"de":"Hallo"}');
    expect(formatValue(['a', 'b'])).toBe('a, b');
  });
});

describe('previewColumns: the properties the rows carry, in first-seen order, with their labels', () => {
  it('labels known keys and keeps unknown ones', () => {
    const rows = [
      { row: 1, values: { art: 'Eiche', stage: 'erfasst' } },
      { row: 2, values: { art: 'Buche', zusatz: 1 } },
    ];
    expect(previewColumns(rows, { art: 'Art', stage: 'Status' })).toEqual([
      { key: 'art', label: 'Art' },
      { key: 'stage', label: 'Status' },
      { key: 'zusatz', label: 'zusatz' },
    ]);
  });
});
