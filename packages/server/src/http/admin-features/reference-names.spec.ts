// WP-443 (A-048, R14): the names of the references on a page are read for the ids of that page only.
import type { TemplateFile } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../db/driver';
import { CHUNK, referenceNames } from './reference-names';
import { insert, world } from './testkit';

const types = {
  baumart: {
    label: { de: 'Baumart' },
    properties: { name: { type: 'text', required: true }, lat: { type: 'text' } },
  },
  baum: {
    label: { de: 'Baum' },
    properties: {
      art: { type: 'reference', to: 'baumart', display_property: 'lat' },
      arten: { type: 'reference', to: 'baumart', cardinality: 'many' },
    },
  },
} as unknown as NonNullable<TemplateFile['types']>;

/** A db whose statements record the parameters they were run with. */
function spy(db: Db, seen: unknown[][]): Db {
  return {
    ...db,
    prepare: <Row>(sql: string) => {
      const stmt = db.prepare<Row>(sql);
      return {
        ...stmt,
        all: (...params: Parameters<typeof stmt.all>) => {
          seen.push(params);
          return stmt.all(...params);
        },
      };
    },
  } as Db;
}

describe('reference names of a page', () => {
  it('reads only the referenced ids of a 20k-row target, in chunks, and names them by the Anzeigefeld', () => {
    const w = world();
    w.db.transaction(() => {
      for (let i = 0; i < 20_000; i++)
        insert(w.db, {
          id: `a${i}`,
          type: 'baumart',
          props: { name: `Art ${i}`, lat: `Lat ${i}` },
        });
    });
    const seen: unknown[][] = [];
    const rows = [
      { art: 'a7', arten: ['a7', 'a19999'] },
      { art: 'a7', arten: ['a3'] },
      { art: 'gone', arten: [] },
    ];
    const out = referenceNames(spy(w.db, seen), types, types['baum'] as never, rows);
    expect(out).toEqual({
      art: { a7: 'Lat 7' },
      arten: { a7: 'Art 7', a19999: 'Art 19999', a3: 'Art 3' },
    });
    const read = seen.flat();
    expect(new Set(read)).toEqual(new Set(['a7', 'a19999', 'a3', 'gone']));
    expect(read.length).toBeLessThanOrEqual(8);
  });

  it('splits many distinct ids into chunks, never one read per id and never the table', () => {
    const w = world();
    const n = CHUNK * 2 + 5;
    for (let i = 0; i < n; i++) insert(w.db, { id: `b${i}`, type: 'baumart', props: { name: `B${i}` } });
    const seen: unknown[][] = [];
    const rows = [{ arten: Array.from({ length: n }, (_, i) => `b${i}`) }];
    const out = referenceNames(spy(w.db, seen), types, types['baum'] as never, rows);
    expect(Object.keys(out['arten'] ?? {})).toHaveLength(n);
    expect(seen).toHaveLength(3);
  });

  it('a reference to a feature of another type is not named', () => {
    const w = world();
    insert(w.db, { id: 'x1', type: 'baum', props: { name: 'Falsch' } });
    expect(referenceNames(w.db, types, types['baum'] as never, [{ art: 'x1' }])['art']).toEqual({});
  });

  it('a deleted target is named like any other; an id with no row is absent (WP-1077)', () => {
    const w = world();
    insert(w.db, { id: 'd1', type: 'baumart', lifecycle: 'deleted', props: { name: 'Weg', lat: 'Lat weg' } });
    const rows = [{ art: 'd1' }, { art: 'nirgends' }];
    expect(referenceNames(w.db, types, types['baum'] as never, rows)['art']).toEqual({ d1: 'Lat weg' });
  });
});
