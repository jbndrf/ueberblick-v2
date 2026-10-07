// WP-450 / A-049: each form has its own layout. The model reads width and line from the form entry; the
// property's `display` (the Daten view) never reaches a form, and two forms of one type differ.
import { describe, expect, it } from 'vitest';
import type { Property } from '@ueberblick/core/model';
import { buildFormModel } from './model';
import { formLines } from './layout';

const withDisplay = (type: string) => ({ type, display: { row: 1, column: 'left' } }) as unknown as Property;
const properties = {
  a: withDisplay('text'),
  b: withDisplay('text'),
  c: { type: 'text' } as unknown as Property,
};
const linesOf = (form: Parameters<typeof buildFormModel>[0]['form']): string[][] =>
  formLines(buildFormModel({ form, properties }).fields).map((l) => l.map((f) => f.key));

describe('layout per form', () => {
  it('the property display (the Daten view) does not lay out a form', () => {
    expect(linesOf({ a: {}, b: {}, c: {} })).toEqual([['a'], ['b'], ['c']]);
  });
  it('column and row of the form entry share a line', () => {
    expect(linesOf({ a: { row: 2, column: 'left' }, b: { row: 2, column: 'right' }, c: {} })).toEqual([
      ['a', 'b'],
      ['c'],
    ]);
  });
  it('two forms of one type lay the same properties out differently', () => {
    const one = linesOf({ a: { row: 1, column: 'left' }, b: { row: 1, column: 'right' } });
    const two = linesOf({ b: {}, a: {} });
    expect(one).toEqual([['a', 'b']]);
    expect(two).toEqual([['b'], ['a']]);
  });
});
