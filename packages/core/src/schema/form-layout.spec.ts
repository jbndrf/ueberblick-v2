// WP-450 / A-049: width (`column`) and line (`row`) per form entry, from the same registry as the Daten view.
import { describe, expect, it } from 'vitest';
import { PROPERTY_DISPLAY_COLUMNS } from '../registry';
import { FormFieldSchema } from './task';

const ok = (f: unknown): boolean => FormFieldSchema.safeParse(f).success;

describe('form field: column and row', () => {
  it('accepts every registry column and a numeric row', () => {
    for (const column of PROPERTY_DISPLAY_COLUMNS.keys) expect(ok({ column, row: 1.5 })).toBe(true);
  });
  it('refuses an unknown column or a non-numeric row', () => {
    expect(ok({ column: 'middle' })).toBe(false);
    expect(ok({ row: 'a' })).toBe(false);
  });
});
