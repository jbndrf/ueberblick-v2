import { describe, expect, it } from 'vitest';
import { openProject } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { INITIAL_PROPERTIES, buildModel, initiallyOpen } from './model';
import { addPropertyOp, addRelationOp, addTypeOp, removeOp, setLabelOp, slugKey } from './ops';

const open = () => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

describe('buildModel', () => {
  const model = buildModel(open(), 'en');
  const baum = model.types.find((t) => t.key === 'baum');

  it('lists every type with its properties in file order', () => {
    expect(model.types.map((t) => t.key)).toContain('baum');
    expect(baum?.properties[0]?.key).toBe('geometrie');
    expect(baum?.label).toBe('Tree');
  });

  it('marks geometry properties with Z capability and the primary one', () => {
    const g = baum?.properties.find((p) => p.key === 'geometrie');
    expect(g).toMatchObject({ geometry: true, z: true, primary: true });
    expect(baum?.properties.find((p) => p.key === 'befund')).toMatchObject({ geometry: false, z: false });
  });

  it('draws a reference property as a solid edge and a derived relation as a dashed one with its predicate', () => {
    const ref = model.edges.find((e) => e.from === 'baum' && e.key === 'art');
    expect(ref).toMatchObject({ to: 'baumart', dashed: false });
    const derived = model.edges.find((e) => e.from === 'baum' && e.key === 'flaeche');
    expect(derived).toMatchObject({ to: 'flaeche', dashed: true, label: 'within' });
  });

  it('takes the marking from provenance', () => {
    expect(baum?.provenance).toBe('changed');
    expect(model.types.find((t) => t.key === 'flaeche')?.provenance).toBe('template');
    const d = open()
      .apply(addPropertyOp('baum', 'neu', { label: 'Neu', locale: 'en', type: 'text' }))
      .doc.apply(setLabelOp(open().effective(), 'types.baum.properties.befund', 'en', 'Finding')).doc;
    const b = buildModel(d, 'en').types.find((t) => t.key === 'baum');
    expect(b?.properties.find((p) => p.key === 'neu')?.provenance).toBe('added');
    expect(b?.properties.find((p) => p.key === 'befund')?.provenance).toBe('changed');
    expect(b?.properties.find((p) => p.key === 'art')?.provenance).toBe('template');
  });
});

describe('ops', () => {
  it('slugKey makes a valid, unique key', () => {
    expect(slugKey('Höhe (m)', new Set())).toBe('hoehe_m');
    expect(slugKey('3D', new Set())).toBe('k3d');
    expect(slugKey('', new Set())).toBe('neu');
    expect(slugKey('Art', new Set(['art', 'art_2']))).toBe('art_3');
  });

  it('adds a property that the schema accepts, for the types that need extra fields', () => {
    let doc = open();
    const before = doc.problems().length;
    const add = (key: string, draft: Parameters<typeof addPropertyOp>[2]) => {
      doc = doc.apply(addPropertyOp('baum', key, draft)).doc;
    };
    add('p_sel', { label: 'S', locale: 'de', type: 'select', options: 'Rot, Grün' });
    add('p_ref', { label: 'R', locale: 'de', type: 'reference', to: 'flaeche' });
    add('p_geo', { label: 'G', locale: 'de', type: 'geometry', geometryType: 'polygon' });
    expect(doc.effective().types?.['baum']?.properties['p_sel']).toMatchObject({
      type: 'select',
      options: { rot: 'Rot', gruen: 'Grün' },
    });
    expect(
      doc
        .problems()
        .slice(before)
        .map((p) => p.code),
    ).toEqual(['dead_option', 'dead_option']);
  });

  it('adds a type and a relation', () => {
    let doc = open().apply(addTypeOp('spielplatz', 'Spielplatz', 'de')).doc;
    doc = doc.apply(addRelationOp(doc.effective(), 'spielplatz', 'flaeche', { to: 'flaeche' })).doc;
    expect(doc.effective().types?.['spielplatz']?.relations?.['flaeche']).toEqual({ to: 'flaeche' });
  });

  it('removes an added entity by reset and a template entity by hide', () => {
    let doc = open().apply(addPropertyOp('baum', 'neu', { label: 'Neu', locale: 'en', type: 'text' })).doc;
    doc = doc.apply(removeOp(doc, 'types.baum.properties.neu')).doc;
    expect(doc.effective().types?.['baum']?.properties['neu']).toBeUndefined();
    const hidden = doc.apply(removeOp(doc, 'types.baum.properties.beschreibung')).doc;
    expect(hidden.effective().types?.['baum']?.properties['beschreibung']).toBeUndefined();
    expect(hidden.overlay().hide).toContain('types.baum.properties.beschreibung');
  });
});

describe('initiallyOpen (R14: the first render is bounded)', () => {
  const type = (key: string, n: number) => ({
    key,
    path: `types.${key}`,
    label: key,
    provenance: 'template' as const,
    properties: Array.from({ length: n }, (_, i) => ({ key: `p${i}` }) as never),
    edges: [],
  });

  it('opens the boxes in file order while their properties fit the budget', () => {
    const types = [type('a', 30), type('b', 10), type('c', 5), type('d', 1)];
    expect([...initiallyOpen(types)]).toEqual(['a', 'b']);
  });

  it('always opens the first box, however large, and every box of a small project', () => {
    expect([...initiallyOpen([type('big', INITIAL_PROPERTIES * 3), type('x', 1)])]).toEqual(['big']);
    expect(initiallyOpen(buildModel(open(), 'en').types).size).toBe(buildModel(open(), 'en').types.length);
  });

  it('is bounded for any project size', () => {
    const types = Array.from({ length: 200 }, (_, i) => type(`t${i}`, 7));
    let shown = 0;
    const openKeys = initiallyOpen(types);
    for (const t of types) if (openKeys.has(t.key)) shown += t.properties.length;
    expect(shown).toBeLessThanOrEqual(INITIAL_PROPERTIES + 7);
  });
});
