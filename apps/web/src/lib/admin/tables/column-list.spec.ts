// WP-382: the list the column manager edits; the array order is the column order (Q15: the first is the Hauptspalte).
import { describe, expect, it } from 'vitest';
import { withAdded } from './column-list';
import { emptyForm } from '../columns/form';
import type { ColumnSpec } from './types';

const base: ColumnSpec[] = [
  { key: 'titel', label: 'Titel', type: 'text', required: true },
  { key: 'stueck', label: 'Stück', type: 'number', default: 2 },
  { key: 'aktiv', label: 'Aktiv', type: 'boolean' },
];
const keys = (l: readonly ColumnSpec[]) => l.map((c) => c.key);

describe('column list', () => {
  it('adds a column at the end with a temporary key, its type, required flag and typed default', () => {
    const l = withAdded(base, { label: ' Menge ', type: 'number', required: true, defaultText: '5' });
    expect(l[3]).toEqual({ key: 'new:1', label: 'Menge', type: 'number', default: 5, required: true });
    expect(keys(withAdded(l, emptyForm('text')))).toEqual(['titel', 'stueck', 'aktiv', 'new:1', 'new:2']);
  });
});
