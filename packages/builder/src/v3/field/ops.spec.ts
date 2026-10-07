import fc from 'fast-check';
import type { Property } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc, type Op } from '../../doc';
import { musterstadt } from '../../testing/golden';
import {
  addOptionOp,
  changeTypeOp,
  deletePropertyOps,
  moveOptionOp,
  optionRows,
  removeOptionOps,
  renameOptionOp,
  setLabelOp,
  setRequiredOp,
  usagesOf,
} from './ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const prop = (d: Doc, p: string) => d.effective().types?.['baum']?.properties[p];
const propOf = (d: Doc, p: string): Property => {
  const found = prop(d, p);
  if (found === undefined) throw new Error(`no property ${p}`);
  return found;
};

function take(doc: Doc, op: Op | undefined): Doc {
  expect(op).toBeDefined();
  const r = doc.apply(op as Op);
  expect(r.refused).toBeUndefined();
  return r.doc;
}

describe('label, required and options edit the Doc and the draft stays clean (acceptance 1)', () => {
  it('label: sets the language of the builder and keeps the others', () => {
    const doc = open();
    const next = take(
      doc,
      setLabelOp(doc.effective(), 'types.baum.properties.vitalitaet', 'de', 'Vitalstufe'),
    );
    expect(prop(next, 'vitalitaet')?.label).toMatchObject({ de: 'Vitalstufe', en: 'Vitality (Roloff)' });
    expect(next.problems()).toEqual(doc.problems());
  });

  it('required: toggles the property flag', () => {
    const doc = open();
    const next = take(doc, setRequiredOp(doc.effective(), 'types.baum.properties.hoehe_m', true));
    expect(prop(next, 'hoehe_m')?.required).toBe(true);
    expect(next.problems()).toEqual(doc.problems());
  });

  it('options: add, rename, reorder and remove, each one op', () => {
    let doc = open();
    const base = optionRows(propOf(doc, 'vitalitaet'), 'de');
    expect(base.length).toBeGreaterThan(1);
    const first = base[0] ?? { key: '', label: '' };

    doc = take(doc, addOptionOp(doc.effective(), 'baum', 'vitalitaet', 'Totholz', 'de'));
    const added = optionRows(propOf(doc, 'vitalitaet'), 'de');
    expect(added.at(-1)).toMatchObject({ key: 'totholz', label: 'Totholz' });

    doc = take(doc, renameOptionOp(doc.effective(), 'baum', 'vitalitaet', first.key, 'Erster', 'de'));
    expect(optionRows(propOf(doc, 'vitalitaet'), 'de')[0]).toEqual({
      key: first.key,
      label: 'Erster',
      hint: '',
    });

    doc = take(doc, moveOptionOp(doc.effective(), 'baum', 'vitalitaet', 'totholz', -1));
    const moved = optionRows(propOf(doc, 'vitalitaet'), 'de').map((r) => r.key);
    expect(moved.at(-2)).toBe('totholz');

    for (const op of removeOptionOps(doc.effective(), 'baum', 'vitalitaet', 'totholz')) doc = take(doc, op);
    expect(optionRows(propOf(doc, 'vitalitaet'), 'de').map((r) => r.key)).not.toContain('totholz');
    expect(doc.problems().filter((p) => p.path.includes('vitalitaet'))).toEqual([]);
  });

  it('a new option key comes from the label and never collides', () => {
    let doc = open();
    for (let i = 0; i < 3; i++)
      doc = take(doc, addOptionOp(doc.effective(), 'baum', 'vitalitaet', 'Neu', 'de'));
    const keys = optionRows(propOf(doc, 'vitalitaet'), 'de').map((r) => r.key);
    expect(keys.filter((k) => k.startsWith('neu'))).toEqual(['neu', 'neu_2', 'neu_3']);
  });
});

describe('option rename keeps the key (acceptance 3)', () => {
  it('property: any rename changes the label only, keys and their order stay', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim() !== ''),
        (text) => {
          const doc = open();
          const before = optionRows(propOf(doc, 'vitalitaet'), 'de');
          const key = before[1]?.key ?? '';
          const next = take(doc, renameOptionOp(doc.effective(), 'baum', 'vitalitaet', key, text, 'de'));
          const after = optionRows(propOf(next, 'vitalitaet'), 'de');
          expect(after.map((r) => r.key)).toEqual(before.map((r) => r.key));
          expect(after[1]?.label).toBe(text);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('changeTypeOp', () => {
  it('text to select seeds the options the type requires, and the draft stays valid', () => {
    const doc = open();
    const next = take(
      doc,
      changeTypeOp(doc.effective(), 'baum', 'patenschaft', 'select', ['baum', 'baumart']),
    );
    expect(prop(next, 'patenschaft')).toMatchObject({ type: 'select', options: {} });
    expect(prop(next, 'patenschaft')?.label).toBeDefined();
  });

  it('number to text drops min and max; select to reference seeds `to`', () => {
    let doc = open();
    doc = take(doc, changeTypeOp(doc.effective(), 'baum', 'hoehe_m', 'text', ['baum']));
    const p = prop(doc, 'hoehe_m') as Record<string, unknown>;
    expect(p['type']).toBe('text');
    expect('min' in p || 'max' in p).toBe(false);
    doc = take(doc, changeTypeOp(doc.effective(), 'baum', 'vitalitaet', 'reference', ['baumart', 'baum']));
    expect(prop(doc, 'vitalitaet')).toMatchObject({ type: 'reference', to: 'baumart' });
  });

  it('keeps required and the label; same type is no op', () => {
    const doc = open();
    expect(changeTypeOp(doc.effective(), 'baum', 'hoehe_m', 'number', ['baum'])).toBeUndefined();
    const next = take(doc, changeTypeOp(doc.effective(), 'baum', 'hoehe_m', 'integer', ['baum']));
    expect(prop(next, 'hoehe_m')).toMatchObject({ type: 'integer' });
  });

  it('refuses a reference when there is no type to point at', () => {
    expect(changeTypeOp(open().effective(), 'baum', 'patenschaft', 'reference', [])).toBeUndefined();
  });
});

describe('delete a property entirely', () => {
  it('lists the task forms that use it', () => {
    const u = usagesOf(open().effective(), 'baum', 'befund');
    expect(u.tasks.length).toBeGreaterThan(0);
  });

  it('removes the property, its form entries and its permission entries in one step', () => {
    const doc = open();
    const ops = deletePropertyOps(doc, 'baum', 'befund');
    const res = applyOps(doc, ops);
    expect('refused' in res).toBe(false);
    if ('refused' in res) return;
    const file = res.doc.effective();
    expect(file.types?.['baum']?.properties['befund']).toBeUndefined();
    expect(Object.keys(file.types?.['baum']?.permissions?.write as object)).not.toContain('befund');
    for (const t of usagesOf(doc.effective(), 'baum', 'befund').tasks) {
      expect(Object.keys(file.tasks?.[t]?.form ?? {})).not.toContain('befund');
    }
    expect(
      res.problems.filter((p) => /^(tasks\.|types\.baum\.(permissions|properties))/.test(p.path)),
    ).toEqual([]);
  });

  it('an added property is dropped, not hidden', () => {
    const doc = open();
    const ops = deletePropertyOps(doc, 'baum', 'patenschaft');
    expect(ops[0]?.kind).toBe('reset');
  });
});
