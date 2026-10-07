import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import { musterstadt } from '../../testing/golden';
import { computedOps, dependenciesOf, selfReads } from './computed';
import { fileTypesOps, filePresetOf, maxFilesOps, numberLimitOps } from './type-ops';
import { changeTypeOp } from './ops';

const TYPE = 'baum';
const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const prop = (doc: Doc, key: string) => doc.effective().types?.[TYPE]?.properties[key];

function apply(doc: Doc, ops: readonly Op[]): Doc {
  let cur = doc;
  for (const op of ops) {
    const r = cur.apply(op);
    expect(r.refused, JSON.stringify(op)).toBeUndefined();
    cur = r.doc;
  }
  return cur;
}
const reloaded = (doc: Doc): Doc => openProject(musterstadt.templateSrc, doc.save().overlaySrc);

describe('type settings of a property', () => {
  it('number min and max round-trip and can be removed', () => {
    let doc = apply(open(), numberLimitOps(open(), TYPE, 'hoehe_m', 'max', 80));
    expect(prop(reloaded(doc), 'hoehe_m')).toMatchObject({ min: 0, max: 80 });
    doc = apply(doc, numberLimitOps(doc, TYPE, 'hoehe_m', 'min', undefined));
    expect(prop(doc, 'hoehe_m')?.min).toBeUndefined();
    expect(prop(doc, 'hoehe_m')?.max).toBe(80);
  });

  it('file types are a preset: all, images, documents; another list is custom and left alone', () => {
    expect(filePresetOf({})).toBe('all');
    expect(filePresetOf({ accept: ['image/*'] })).toBe('images');
    expect(filePresetOf({ accept: ['application/pdf'] })).toBe('custom');
    let doc = apply(open(), fileTypesOps(open(), TYPE, 'foto', 'documents'));
    expect(prop(doc, 'foto')?.accept).toEqual(['.pdf', '.doc', '.docx', '.txt']);
    expect(filePresetOf(prop(reloaded(doc), 'foto') ?? {})).toBe('documents');
    doc = apply(doc, fileTypesOps(doc, TYPE, 'foto', 'all'));
    expect(prop(doc, 'foto')?.accept).toBeUndefined();
    doc = apply(doc, fileTypesOps(doc, TYPE, 'foto', 'images'));
    expect(prop(doc, 'foto')?.accept).toEqual(['image/*']);
  });

  it('the maximum number of files (Q7) is max_files', () => {
    const doc = apply(open(), maxFilesOps(open(), TYPE, 'foto', 3));
    expect(prop(reloaded(doc), 'foto')?.max_files).toBe(3);
    expect(prop(apply(doc, maxFilesOps(doc, TYPE, 'foto', undefined)), 'foto')?.max_files).toBeUndefined();
  });

  it('the date mode is the property type (Q8)', () => {
    const doc = open();
    const file = doc.effective();
    const op = changeTypeOp(file, TYPE, 'faellig_am', 'datetime', Object.keys(file.types ?? {}));
    expect(op).toBeDefined();
    expect(prop(apply(doc, op ? [op] : []), 'faellig_am')?.type).toBe('datetime');
  });
});

describe('Berechnet', () => {
  const withProp = (): Doc =>
    apply(open(), [
      {
        kind: 'add',
        path: 'types.baum.properties.hoehe_x2',
        value: { type: 'number', label: { de: 'Doppelt' } },
      },
    ]);
  const scope = 'types.baum.properties.hoehe_x2';

  it('reads the properties an expression depends on, once each, in order', () => {
    expect(selfReads('self.a * 2 + self.b + self.a')).toEqual(['a', 'b']);
    expect(selfReads('round(self.hoehe_m / 2)')).toEqual(['hoehe_m']);
    expect(selfReads('inputs.x + other.y')).toEqual([]);
    expect(selfReads('self.a +')).toEqual([]);
  });

  it('lists the inputs with their labels; an unknown property has no label', () => {
    const deps = dependenciesOf('self.hoehe_m * self.gibt_es_nicht', open().effective(), TYPE, 'de');
    expect(deps).toEqual([
      { key: 'hoehe_m', label: 'Höhe (m)' },
      { key: 'gibt_es_nicht', label: null },
    ]);
  });

  it('a valid expression saves and survives a reload', () => {
    const doc = withProp();
    const plan = planEdit(doc, computedOps(doc, TYPE, 'hoehe_x2', 'self.hoehe_m * 2'), scope, 'de');
    expect(plan.ok || plan.reason === 'no_effect').toBe(true); // planEdit judges effect on tasks only; commitForm judges the file
    const next = apply(doc, computedOps(doc, TYPE, 'hoehe_x2', 'self.hoehe_m * 2'));
    expect(prop(reloaded(next), 'hoehe_x2')?.computed).toBe('self.hoehe_m * 2');
    expect(next.problems().filter((p) => p.path.startsWith(scope))).toEqual([]);
  });

  it('an invalid expression shows the problem and is not applied', () => {
    const doc = withProp();
    for (const bad of ['self.gibt_es_nicht * 2', "'text'", 'self.hoehe_m *']) {
      const plan = planEdit(doc, computedOps(doc, TYPE, 'hoehe_x2', bad), scope, 'de');
      expect(plan.ok, bad).toBe(false);
      if (!plan.ok) expect(plan.reason === 'problem' || plan.reason === 'refused', bad).toBe(true);
    }
  });

  it('an expression that reads itself is a cycle problem', () => {
    const doc = withProp();
    const plan = planEdit(doc, computedOps(doc, TYPE, 'hoehe_x2', 'self.hoehe_x2 + 1'), scope, 'de');
    expect(plan.ok).toBe(false);
  });

  it('an empty text takes Berechnet off', () => {
    const doc = withProp();
    const on = apply(doc, computedOps(doc, TYPE, 'hoehe_x2', 'self.hoehe_m * 2'));
    expect(prop(apply(on, computedOps(on, TYPE, 'hoehe_x2', '  ')), 'hoehe_x2')?.computed).toBeUndefined();
  });
});
