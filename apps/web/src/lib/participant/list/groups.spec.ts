import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@ueberblick/core/model';
import { groupRows } from './groups';

const row = (id: string, name: string, properties: Record<string, string> = {}) => ({
  id: id as FeatureId,
  name,
  properties,
});
const types = { ver: { label: 'Veranstaltung' }, geb: { label: 'Gebäude' } };
const typeOf = (id: FeatureId) => (id.startsWith('g') ? 'geb' : 'ver');
const labelOf = (t: string) => types[t as keyof typeof types].label;
const cols = (t: string) =>
  t === 'ver'
    ? [
        { key: 'titel', label: 'Titel' },
        { key: 'datum', label: 'Datum' },
      ]
    : [{ key: 'adresse', label: 'Adresse' }];

describe('groupRows: one table per Objektart, as v3 groups its cluster detail by type', () => {
  it('lists every row exactly once, with no cap', () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(`v${i}`, `V${i}`));
    const g = groupRows(rows, typeOf, labelOf, cols);
    expect(g).toHaveLength(1);
    expect(g[0]?.rows).toHaveLength(500);
  });
  it('puts a Gebäude under Gebäude, not under the Veranstaltung headers', () => {
    const g = groupRows([row('v1', 'A'), row('g1', 'Gebäude #0009')], typeOf, labelOf, cols);
    expect(g.map((x) => [x.label, x.rows.map((r) => r.id), x.columns.map((c) => c.key)])).toEqual([
      ['Gebäude', ['g1'], ['adresse']],
      ['Veranstaltung', ['v1'], ['titel', 'datum']],
    ]);
  });
  it('drops a column that only repeats the display name', () => {
    const g = groupRows(
      [row('v1', 'Markt', { titel: 'Markt', datum: '1' }), row('v2', 'Fest', { titel: 'Fest', datum: '2' })],
      typeOf,
      labelOf,
      cols,
    );
    expect(g[0]?.columns.map((c) => c.key)).toEqual(['datum']);
  });
  it('keeps a column when one row differs from its name', () => {
    const g = groupRows(
      [row('v1', 'Markt', { titel: 'Markt' }), row('v2', 'Fest #1', { titel: 'Fest' })],
      typeOf,
      labelOf,
      cols,
    );
    expect(g[0]?.columns.map((c) => c.key)).toEqual(['titel', 'datum']);
  });
});
