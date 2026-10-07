// WP-396 (lead-a decision): v3's 'Geometrie beim Erstellen' (inherit / draw / none) as `inherit_position` plus the
// child type's own geometry. Reading back is unambiguous; nothing adds or removes a geometry property.
import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '../../doc';
import { createRelation, listRelations, updateRelation, type RelationEdit, type RelationInput } from './ops';

const TEMPLATE = `
schema: ueberblick/1
template: { key: rel, version: 1.0.0 }
roles: { boss: { label: Boss } }
types:
  eltern:
    label: Eltern
    geometry: ort
    permissions: { see: $all, create: $all, write: $all, delete: [boss] }
    properties: { name: { type: text }, ort: { type: geometry, geometry_type: point } }
  kind:
    label: Kind
    permissions: { see: $all, create: $all, write: $all, delete: [boss] }
    properties: { name: { type: text } }
  baum:
    label: Baum
    geometry: ort
    permissions: { see: $all, create: $all, write: $all, delete: [boss] }
    properties: { ort: { type: geometry, geometry_type: point } }
`;
const open = (src = TEMPLATE): Doc => openProject(src, 'schema: ueberblick/1\nextends: rel@1\n');
const must = (r: RelationEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
const NEW: RelationInput = { name: 'Kinder', parent: 'eltern', child: 'kind', cardinality: 'many' };
const rel = (d: Doc) => listRelations(d, 'de').find((r) => r.id === 'eltern.kinder');
const written = (d: Doc) => d.effective().types?.eltern?.relations?.kinder?.inherit_position;

describe('Geometrie beim Erstellen', () => {
  it('a child without geometry defaults to übernehmen and writes inherit_position', () => {
    const d = must(createRelation(open(), NEW, 'de'));
    expect(written(d)).toBe(true);
    expect(rel(d)).toMatchObject({ geometry: 'inherit', childHasGeometry: false });
    expect(d.problems().filter((p) => p.code === 'inherit_with_own_geometry')).toEqual([]);
  });
  it('keine writes no inherit_position and reads back as keine', () => {
    const d = must(createRelation(open(), { ...NEW, geometry: 'none' }, 'de'));
    expect(written(d)).toBeUndefined();
    expect(rel(d)?.geometry).toBe('none');
  });
  it('a child with its own geometry is always zeichnen, whatever was asked', () => {
    const d = must(createRelation(open(), { ...NEW, child: 'baum', geometry: 'inherit' }, 'de'));
    expect(written(d)).toBeUndefined();
    expect(rel(d)).toMatchObject({ geometry: 'draw', childHasGeometry: true });
  });
  it('switching übernehmen to keine and back rewrites the one key', () => {
    let d = must(createRelation(open(), NEW, 'de'));
    d = must(updateRelation(d, 'eltern.kinder', { geometry: 'none' }, 'de'));
    expect(rel(d)?.geometry).toBe('none');
    expect(written(d)).toBeUndefined();
    d = must(updateRelation(d, 'eltern.kinder', { geometry: 'inherit' }, 'de'));
    expect(rel(d)?.geometry).toBe('inherit');
  });
  it('an update without geometry keeps the mode', () => {
    let d = must(createRelation(open(), { ...NEW, geometry: 'none' }, 'de'));
    d = must(updateRelation(d, 'eltern.kinder', { name: 'Kindlein' }, 'de'));
    expect(rel(d)?.geometry).toBe('none');
  });
  it('moving to a child with geometry drops inherit_position; back to one without gives the default', () => {
    let d = must(createRelation(open(), NEW, 'de'));
    d = must(updateRelation(d, 'eltern.kinder', { child: 'baum' }, 'de'));
    expect(rel(d)).toMatchObject({ geometry: 'draw' });
    d = must(updateRelation(d, 'eltern.kinder', { child: 'kind' }, 'de'));
    expect(rel(d)?.geometry).toBe('inherit');
  });
  it('keeps the engine problem visible when the child gains a geometry later', () => {
    const base = must(createRelation(open(), NEW, 'de'));
    const grown = base.apply({
      kind: 'add',
      path: 'types.kind.properties.ort',
      value: { type: 'geometry', geometry_type: 'point' },
    }).doc;
    const withGeometry = grown.apply({ kind: 'add', path: 'types.kind.geometry', value: 'ort' }).doc;
    expect(rel(withGeometry)?.geometryProblem).toBeTruthy();
    // the way out: choose zeichnen
    const fixed = must(updateRelation(withGeometry, 'eltern.kinder', { geometry: 'draw' }, 'de'));
    expect(rel(fixed)?.geometryProblem).toBeUndefined();
    expect(rel(fixed)?.geometry).toBe('draw');
  });
});
