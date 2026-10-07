import { describe, expect, it } from 'vitest';
import { loadDataPage, type LoadDeps } from './load.server';

const type = {
  label: { de: 'Baum' },
  geometry: 'geometrie',
  properties: { geometrie: { type: 'geometry' }, befund: { type: 'text' } },
};
const deps = (over: Partial<LoadDeps> = {}): LoadDeps => ({
  deployedType: (_p, t) => (t === 'baum' ? (type as never) : undefined),
  deployedMap: () =>
    ({ layers: { b: { kind: 'base', label: 'B', source: { type: 'preset', preset: 'osm' } } } }) as never,
  actors: () => ({
    participants: [
      { id: 'u1', name: 'Anna' },
      { id: 'u2', name: null },
    ],
    admins: [{ id: 'a1', email: 'chef@example.org' }],
  }),
  deployedRoles: () => ({ kontrolle: { label: { de: 'Kontrolle' } } }) as never,
  ...over,
});

describe('data page load', () => {
  it('brings the deployed type and the roster as an id-to-name map', () => {
    const r = loadDataPage(deps(), 'p', 'baum');
    expect(r.type).toEqual(type);
    expect(r.names).toEqual({ u1: 'Anna', a1: 'chef@example.org' });
    expect(r.published).toBe(true);
  });

  it('brings the project base layer as plain tiles for the Standort preview', () => {
    expect(loadDataPage(deps(), 'p', 'baum').basemap?.tiles).toContain('{z}');
    expect(loadDataPage(deps({ deployedMap: () => undefined }), 'p', 'baum').basemap).toBeNull();
  });

  it('a type that is only in the draft has no table yet', () => {
    const r = loadDataPage(deps(), 'p', 'neu');
    expect(r.type).toBeNull();
    expect(r.published).toBe(false);
  });
});
