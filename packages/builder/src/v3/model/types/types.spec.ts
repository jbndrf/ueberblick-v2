import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { splitAutoId, type Problem } from '@ueberblick/core';
import { applyOps, openProject, type Doc } from '../../../doc';
import { goldenProjects, musterstadt } from '../../../testing/golden';
import { DROPPED, duplicateTypeOps, footprint, importTypeOps, relatedTo, removeType } from './index';

const open = (p: { templateSrc: string; overlaySrc: string }): Doc =>
  openProject(p.templateSrc, p.overlaySrc);
const key = (p: Problem): string => `${p.code}|${p.path}|${JSON.stringify(p.message)}`;
const fresh = (before: Doc, after: Doc): Problem[] => {
  const known = new Set(before.problems().map(key));
  return after.problems().filter((p) => !known.has(key(p)));
};
const need = <T>(v: T | undefined): T => {
  if (v === undefined) throw new Error('expected a value');
  return v;
};

function apply(doc: Doc, ops: ReturnType<typeof duplicateTypeOps>['ops']): Doc {
  const r = applyOps(doc, ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}

const pairs = goldenProjects
  .filter((p) => !p.name.includes('violation'))
  .flatMap((p) => Object.keys(open(p).effective().types ?? {}).map((type) => ({ p, type })));

describe('Duplizieren (acceptance 1)', () => {
  it('adds the type, its tasks, its rules and its views under fresh keys', () => {
    const doc = open(musterstadt);
    const file = doc.effective();
    const rel = relatedTo(file, 'baum');
    const copy = duplicateTypeOps(file, 'baum', 'de');
    const next = apply(doc, copy.ops).effective();
    expect(copy.key).toBe('baum_kopie');
    expect(next.types?.[copy.key]).toBeDefined();
    const skipped = copy.dropped.filter((d) => d.kind === DROPPED.task).length;
    expect(skipped).toBeGreaterThan(0); // massnahme_anlegen creates another type
    expect(copy.tasks).toHaveLength(rel.tasks.length - skipped);
    expect(copy.views).toHaveLength(rel.views.length);
    for (const k of copy.tasks) {
      const t = need(next.tasks?.[k]);
      expect([t.on, t.creates].flat()).toContain(copy.key);
    }
    for (const k of copy.views) expect(next.views?.[k]?.source.type).toBe(copy.key);
    expect(need(next.types?.[copy.key]).label).toEqual({ de: 'Baum (Kopie)', en: 'Tree (copy)' });
  });

  it('a second copy takes the next free key', () => {
    const doc = open(musterstadt);
    const once = apply(doc, duplicateTypeOps(doc.effective(), 'baum', 'de').ops);
    expect(duplicateTypeOps(once.effective(), 'baum', 'de').key).toBe('baum_kopie_2');
  });

  it('property: a copy of any type of any golden project adds no problem', () => {
    fc.assert(
      fc.property(fc.constantFrom(...pairs), ({ p, type }) => {
        const doc = open(p);
        const copy = duplicateTypeOps(doc.effective(), type, 'de');
        const next = apply(doc, copy.ops);
        expect(fresh(doc, next)).toEqual([]);
        expect(copy.dropped.every((d) => d.kind === DROPPED.task || d.kind === DROPPED.rule)).toBe(true);
      }),
      { numRuns: 25 },
    );
  });
});

describe('Aus Projekt importieren (acceptance 2)', () => {
  const other = goldenProjects.find((q) => q.name === 'stadtwerke-meldungen.yaml');

  it('a type of a second project lands in the draft; permissions keep only the roles this project has', () => {
    const source = open(need(other)).effective();
    const type = need(Object.keys(source.types ?? {})[0]);
    const doc = open(musterstadt);
    const copy = importTypeOps(source, type, doc.effective(), 'de');
    const next = apply(doc, copy.ops);
    expect(next.effective().types?.[copy.key]).toBeDefined();
    const roles = new Set(Object.keys(doc.effective().roles ?? {}));
    const listed = JSON.stringify(next.effective().types?.[copy.key]?.permissions ?? {});
    for (const role of Object.keys(source.roles ?? {}))
      if (!roles.has(role)) expect(listed).not.toContain(`"${role}"`);
    const foreign = JSON.stringify(source.types?.[type]?.permissions ?? {});
    const lost = Object.keys(source.roles ?? {}).some((r) => !roles.has(r) && foreign.includes(`"${r}"`));
    expect(copy.dropped.some((d) => d.kind === DROPPED.permissions)).toBe(lost);
  });

  it('references to a type this project lacks are reported, not silently dropped', () => {
    const doc = open(musterstadt);
    const source = structuredClone(doc.effective());
    const def = need(source.types?.['baum']);
    def.relations = { ...def.relations, hof: { to: 'gibt_es_nicht' } };
    def.properties['verweis'] = { type: 'reference', to: 'auch_nicht' };
    const target = open(need(other)).effective();
    const copy = importTypeOps(source, 'baum', target, 'de');
    expect(copy.dropped).toContainEqual({ kind: DROPPED.relation, key: 'hof', type: 'gibt_es_nicht' });
    expect(copy.dropped).toContainEqual({ kind: DROPPED.property, key: 'verweis', type: 'auch_nicht' });
    const added = copy.ops.find((o) => o.kind === 'add' && o.path === `types.${copy.key}`);
    const value = (added as { value: { relations?: object; properties: object } }).value;
    expect(value.relations ?? {}).not.toHaveProperty('hof');
    expect(value.properties).not.toHaveProperty('verweis');
  });

  it('a rule that reaches a task of another type is left out and listed', () => {
    const doc = open(musterstadt);
    const source = structuredClone(doc.effective());
    source.tasks = { ...source.tasks, fremd: { label: 'Fremd', on: 'anderes' } } as typeof source.tasks;
    const kontrolle = source.tasks?.['kontrolle'];
    if (kontrolle === undefined) throw new Error('kontrolle missing');
    kontrolle.auto = { ...kontrolle.auto, quer: { after: 'fremd' } };
    const copy = importTypeOps(source, 'baum', doc.effective(), 'de');
    expect(copy.dropped).toContainEqual({ kind: DROPPED.rule, key: 'kontrolle.quer' });
  });
});

describe('an import between two projects of one template', () => {
  it('adds no problem (the e2e journey: flaeche of one baumkataster project into another)', () => {
    const doc = open(musterstadt);
    const copy = importTypeOps(doc.effective(), 'flaeche', doc.effective(), 'de');
    const next = apply(doc, copy.ops);
    expect(fresh(doc, next).map((p) => `${p.code} ${p.path} ${JSON.stringify(p.message)}`)).toEqual([]);
  });
});

describe('Objektart löschen (acceptance 4)', () => {
  it('removes the type, its tasks, rules and views from the effective file', () => {
    const doc = open(need(goldenProjects.find((q) => q.name === 'ordnungsamt-veranstaltungen.yaml')));
    const rel = relatedTo(doc.effective(), 'veranstaltung');
    expect(rel.tasks.length).toBeGreaterThan(0);
    const r = removeType(doc, 'veranstaltung');
    if (!r.ok) throw new Error(r.detail);
    const file = r.doc.effective();
    expect(file.types?.['veranstaltung']).toBeUndefined();
    for (const k of rel.tasks) expect(file.tasks?.[k]).toBeUndefined();
    for (const id of rel.rules) {
      const { task, name } = splitAutoId(id);
      expect(file.tasks?.[task]?.auto?.[name]).toBeUndefined();
    }
    for (const k of rel.views) expect(file.views?.[k]).toBeUndefined();
  });

  it('a template lock that the removal would touch refuses it, with the reason', () => {
    const r = removeType(open(musterstadt), 'baum');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toMatch(/locks/);
  });

  it('removing a copy gives the file back (an added entry is dropped, not hidden)', () => {
    const doc = open(musterstadt);
    const copy = duplicateTypeOps(doc.effective(), 'baum', 'de');
    const withCopy = apply(doc, copy.ops);
    const r = removeType(withCopy, copy.key);
    if (!r.ok) throw new Error(r.detail);
    expect(r.doc.overlay()).toEqual(doc.overlay());
    expect(r.dangling).toEqual([]);
  });

  it('footprint counts stages, tasks, rules and views', () => {
    const f = footprint(open(musterstadt).effective(), 'baum');
    expect(f.stages).toBeGreaterThan(0);
    expect(f.tasks).toBeGreaterThan(0);
  });

  it('property: after a removal the draft has no dangling reference to the type, or reports it as a problem', () => {
    fc.assert(
      fc.property(fc.constantFrom(...pairs), ({ p, type }) => {
        const doc = open(p);
        const r = removeType(doc, type);
        // a template lock refuses the removal: nothing is half removed
        if (!r.ok) {
          expect(r.detail).toMatch(/locks/);
          return;
        }
        const file = r.doc.effective();
        const rel = relatedTo(doc.effective(), type);
        for (const k of rel.tasks) expect(file.tasks?.[k]?.creates).not.toBe(type);
        for (const t of Object.values(file.tasks ?? {})) expect([t.on].flat()).not.toContain(type);
        for (const v of Object.values(file.views ?? {})) expect(v.source.type).not.toBe(type);
        const refs = Object.values(file.types ?? {}).some(
          (t) =>
            Object.values(t.relations ?? {}).some((x) => x.to === type) ||
            Object.values(t.properties).some((x) => x.to === type),
        );
        // a reference to the type that remains is a reported problem (other findings, such as a stage no task sets now, also show)
        if (refs) expect(r.dangling.length).toBeGreaterThan(0);
      }),
      { numRuns: 25 },
    );
  });
});
