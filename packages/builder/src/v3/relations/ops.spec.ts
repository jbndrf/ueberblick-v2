import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { openProject, type Doc } from '../../doc';
import { goldenProjects, musterstadt } from '../../testing/golden';
import {
  createRelation,
  deleteRelation,
  listRelations,
  relationKeyOf,
  typeOptions,
  updateRelation,
  type RelationEdit,
} from './ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const ordnungsamt = (): Doc => {
  const p = goldenProjects.find((q) => q.name.startsWith('ordnungsamt'));
  if (p === undefined) throw new Error('golden project missing');
  return openProject(p.templateSrc, p.overlaySrc);
};
const must = (r: RelationEdit): Doc => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.doc;
};
// The template's own child list (baumkataster declares baum.massnahmen, inverse_of massnahme.baum).
const TEMPLATE_REL = {
  id: 'baum.massnahmen',
  parent: 'baum',
  child: 'massnahme',
  source: 'template',
} as const;
const NEW = { name: 'Inspektionen', parent: 'flaeche', child: 'massnahme', cardinality: 'many' } as const;

describe('listRelations', () => {
  it('lists the template relations that have a child side, with provenance', () => {
    const rel = listRelations(ordnungsamt(), 'de').find((r) => r.id === 'veranstaltung.auflagen');
    expect(rel).toMatchObject({
      parent: 'veranstaltung',
      child: 'auflage',
      refKey: 'veranstaltung',
      cardinality: 'many',
      source: 'template',
    });
  });

  it('does not list derived relations or plain references', () => {
    const listed = listRelations(open(), 'de');
    expect(listed.map((r) => r.id)).toEqual(['baum.massnahmen']);
    expect(listed[0]).toMatchObject(TEMPLATE_REL);
  });

  it('typeOptions gives every type with its label in the page language', () => {
    const opts = typeOptions(open(), 'de');
    expect(opts.find((o) => o.key === 'baum')?.label).toBe('Baum');
    expect(opts.length).toBeGreaterThan(2);
  });
});

describe('createRelation', () => {
  it('writes the reference on the child and the inverse list on the parent; the YAML shows both', () => {
    const doc = must(createRelation(open(), NEW, 'de'));
    const f = doc.effective();
    expect(f.types?.['massnahme']?.properties['flaeche']).toMatchObject({ type: 'reference', to: 'flaeche' });
    expect(f.types?.['flaeche']?.relations?.['inspektionen']).toMatchObject({
      to: 'massnahme',
      inverse_of: 'massnahme.flaeche',
      cardinality: 'many',
    });
    expect(doc.save().overlaySrc).toContain('inverse_of: massnahme.flaeche');
    expect(doc.problems().length).toBe(open().problems().length);
    const listed = listRelations(doc, 'de').find((r) => r.id === 'flaeche.inspektionen');
    expect(listed).toMatchObject({ label: 'Inspektionen', child: 'massnahme', source: 'overlay' });
  });

  it('refuses an empty name, the same type on both sides and an unknown type', () => {
    expect(createRelation(open(), { ...NEW, name: '  ' }, 'de')).toMatchObject({ code: 'name_empty' });
    expect(createRelation(open(), { ...NEW, child: 'flaeche' }, 'de')).toMatchObject({ code: 'same_type' });
    expect(createRelation(open(), { ...NEW, child: 'gibtsnicht' }, 'de')).toMatchObject({
      code: 'unknown_type',
    });
  });

  it('a second relation with the same name gets a new key', () => {
    const once = must(createRelation(open(), NEW, 'de'));
    const twice = must(createRelation(once, { ...NEW, child: 'baum' }, 'de'));
    const listed = listRelations(twice, 'de');
    expect(listed.find((r) => r.id === 'baum.massnahmen')).toMatchObject(TEMPLATE_REL);
    expect(listed.filter((r) => r.source === 'overlay').map((r) => r.id)).toEqual([
      'flaeche.inspektionen',
      'flaeche.inspektionen_2',
    ]);
  });

  it('relationKeyOf always gives a valid config key', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        expect(relationKeyOf(s, new Set())).toMatch(/^[a-z][a-z0-9_]*$/);
      }),
    );
  });
});

describe('updateRelation', () => {
  const made = () => must(createRelation(open(), NEW, 'de'));

  it('changes the name and the multiplicity in place', () => {
    const doc = must(
      updateRelation(made(), 'flaeche.inspektionen', { name: 'Kontrollen', cardinality: 'one' }, 'de'),
    );
    const rel = doc.effective().types?.['flaeche']?.relations?.['inspektionen'];
    expect(rel).toMatchObject({ cardinality: 'one', label: { de: 'Kontrollen' } });
  });

  it('changing the child moves the reference and keeps the key', () => {
    const doc = must(updateRelation(made(), 'flaeche.inspektionen', { child: 'baum' }, 'de'));
    const f = doc.effective();
    expect(f.types?.['baum']?.properties['flaeche']).toMatchObject({ type: 'reference', to: 'flaeche' });
    expect(f.types?.['massnahme']?.properties['flaeche']).toBeUndefined();
    expect(f.types?.['flaeche']?.relations?.['inspektionen']).toMatchObject({
      to: 'baum',
      inverse_of: 'baum.flaeche',
    });
  });

  it('refuses an unknown relation and the same type on both sides', () => {
    expect(updateRelation(made(), 'flaeche.nope', { name: 'x' }, 'de')).toMatchObject({
      code: 'unknown_relation',
    });
    expect(updateRelation(made(), 'flaeche.inspektionen', { child: 'flaeche' }, 'de')).toMatchObject({
      code: 'same_type',
    });
  });

  it('works on a relation of the template', () => {
    const doc = must(updateRelation(ordnungsamt(), 'veranstaltung.auflagen', { name: 'Bedingungen' }, 'de'));
    expect(doc.effective().types?.['veranstaltung']?.relations?.['auflagen']?.label).toMatchObject({
      de: 'Bedingungen',
    });
  });

  it('refuses in place when the compile check fails (a rule reads the list with all())', () => {
    const r = updateRelation(ordnungsamt(), 'veranstaltung.auflagen', { cardinality: 'one' }, 'de');
    expect(r).toMatchObject({ ok: false, code: 'problem' });
  });
});

describe('deleteRelation', () => {
  it('removes the relation and its reference again', () => {
    const base = open();
    const made = must(createRelation(base, NEW, 'de'));
    const gone = deleteRelation(made, 'flaeche.inspektionen');
    if ('refused' in gone) throw new Error(gone.refused);
    const left = listRelations(gone.doc, 'de');
    expect(left.some((r) => r.id === 'flaeche.inspektionen')).toBe(false);
    expect(left.map((r) => r.id)).toEqual(['baum.massnahmen']);
    expect(left[0]).toMatchObject(TEMPLATE_REL);
    expect(gone.doc.effective().types?.['massnahme']?.properties['flaeche']).toBeUndefined();
    expect(gone.child).toBe('massnahme');
    expect(gone.refKey).toBe('flaeche');
    expect(gone.doc.problems().length).toBe(base.problems().length);
  });

  it('hides a relation of the template', () => {
    const gone = deleteRelation(ordnungsamt(), 'veranstaltung.auflagen');
    if ('refused' in gone) throw new Error(gone.refused);
    expect(gone.doc.effective().types?.['veranstaltung']?.relations?.['auflagen']).toBeUndefined();
    expect(gone.doc.overlay().hide).toContain('types.veranstaltung.relations.auflagen');
  });

  it('refuses an unknown relation', () => {
    expect(deleteRelation(open(), 'flaeche.nope')).toEqual({ refused: 'flaeche.nope' });
  });
});
