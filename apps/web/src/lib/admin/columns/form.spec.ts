// WP-382: the form and list logic the participants' and the tables' column managers share.
import { describe, expect, it } from 'vitest';
import {
  defaultOf,
  definitionOf,
  emptyForm,
  formOf,
  labelTaken,
  withEdited,
  without,
  type ColumnDef,
} from './form';

const base: ColumnDef[] = [
  { key: 'titel', label: 'Titel', type: 'text', required: true },
  { key: 'stueck', label: 'Stück', type: 'number', default: 2 },
];

describe('column form', () => {
  it('turns the default text into the type: number, boolean, text; unusable or empty is none', () => {
    expect(defaultOf('number', '2,5')).toBeUndefined();
    expect(defaultOf('number', '2.5')).toBe(2.5);
    expect(defaultOf('boolean', 'Ja')).toBe(true);
    expect(defaultOf('boolean', 'nein')).toBe(false);
    expect(defaultOf('text', ' x ')).toBe('x');
    expect(defaultOf('date', '')).toBeUndefined();
  });

  it('builds a column from the form: trimmed name, typed default, required only when set', () => {
    expect(
      definitionOf('menge', { label: ' Menge ', type: 'number', required: true, defaultText: '5' }),
    ).toEqual({
      key: 'menge',
      label: 'Menge',
      type: 'number',
      default: 5,
      required: true,
    });
    expect(definitionOf('x', emptyForm('text'))).toEqual({ key: 'x', label: '', type: 'text' });
  });

  it('edits in place and keeps the key; the form of a column reads it back', () => {
    const edited = withEdited(base, 'stueck', {
      label: 'Anzahl',
      type: 'number',
      required: false,
      defaultText: '',
    });
    expect(edited[1]).toEqual({ key: 'stueck', label: 'Anzahl', type: 'number' });
    expect(formOf(base[1] as ColumnDef)).toEqual({
      label: 'Stück',
      type: 'number',
      required: false,
      defaultText: '2',
    });
  });

  it('removes a column, and finds a name that exists already (any case), except the edited column', () => {
    expect(without(base, 'stueck').map((c) => c.key)).toEqual(['titel']);
    expect(labelTaken(base, ' titel ')).toBe(true);
    expect(labelTaken(base, 'Titel', 'titel')).toBe(false);
    expect(labelTaken(base, 'Neu')).toBe(false);
  });
});
