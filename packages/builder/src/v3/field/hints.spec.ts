// WP-393: the explanation text of an option (v3 "Antwort, Erklärungstext") is `option_hints` of the property.
import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { newFieldOps } from '../form/ops';
import { PALETTE_TILES } from '../form/palette';
import { addOptionOp, changeTypeOp, optionRows, removeOptionOps, setOptionHintOp } from './ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const key = (p: { code: string; path: string }): string => `${p.code} ${p.path}`;
function take(doc: Doc, op: Op | undefined): Doc {
  expect(op).toBeDefined();
  const r = doc.apply(op as Op);
  expect(r.refused).toBeUndefined();
  return r.doc;
}
const prop = (d: Doc) => d.effective().types?.['baum']?.properties['vitalitaet'];

describe('the option hint', () => {
  it('writes the text in the builder language, keeps the other languages, reads back in the rows', () => {
    let doc = open();
    const before = new Set(doc.problems().map(key));
    doc = take(doc, setOptionHintOp(doc.effective(), 'baum', 'vitalitaet', 'v0', 'Abgestorben', 'de'));
    expect(prop(doc)?.option_hints).toEqual({ v0: { de: 'Abgestorben' } });
    doc = take(doc, setOptionHintOp(doc.effective(), 'baum', 'vitalitaet', 'v0', 'Dead', 'en'));
    expect(prop(doc)?.option_hints).toEqual({ v0: { de: 'Abgestorben', en: 'Dead' } });
    expect(optionRows(prop(doc) as never, 'de')[0]).toMatchObject({ key: 'v0', hint: 'Abgestorben' });
    expect(optionRows(prop(doc) as never, 'en')[0]).toMatchObject({ key: 'v0', hint: 'Dead' });
    expect(
      doc
        .problems()
        .map(key)
        .filter((k) => !before.has(k)),
    ).toEqual([]);
  });

  it('empty text removes the language, and the option when none is left; nothing to remove is no op', () => {
    let doc = open();
    expect(setOptionHintOp(doc.effective(), 'baum', 'vitalitaet', 'v0', '  ', 'de')).toBeUndefined();
    doc = take(doc, setOptionHintOp(doc.effective(), 'baum', 'vitalitaet', 'v0', 'Abgestorben', 'de'));
    doc = take(doc, setOptionHintOp(doc.effective(), 'baum', 'vitalitaet', 'v0', '', 'de'));
    expect(prop(doc)?.option_hints).toEqual({});
  });

  it('removing an option takes its hint with it, so the file stays valid', () => {
    let doc = open();
    doc = take(doc, setOptionHintOp(doc.effective(), 'baum', 'vitalitaet', 'v4', 'Sehr gut', 'de'));
    const ops = removeOptionOps(doc.effective(), 'baum', 'vitalitaet', 'v4');
    expect(ops).toHaveLength(2);
    for (const op of ops) doc = take(doc, op);
    expect(Object.keys(prop(doc)?.options ?? {})).not.toContain('v4');
    expect(prop(doc)?.option_hints).toEqual({});
    expect(doc.problems().filter((p) => p.path.includes('vitalitaet'))).toEqual([]);
  });

  it('the option removal alone, without the hint op first, is refused', () => {
    let doc = open();
    doc = take(doc, setOptionHintOp(doc.effective(), 'baum', 'vitalitaet', 'v4', 'Sehr gut', 'de'));
    const ops = removeOptionOps(doc.effective(), 'baum', 'vitalitaet', 'v4');
    const last = ops[ops.length - 1] as Op;
    expect(doc.apply(last).refused).toBeDefined();
  });

  it('turning a select of the draft into a multiselect keeps the hints', () => {
    const doc = open();
    const tile = PALETTE_TILES.find((x) => x.key === 'dropdown');
    if (tile === undefined) throw new Error('tile');
    const made = newFieldOps(doc, 'kontrolle', 'baum', tile, 'Neu', 'de', { kind: 'page', page: 0 });
    let cur = doc;
    for (const op of made.ops) cur = take(cur, op);
    cur = take(cur, addOptionOp(cur.effective(), 'baum', made.key, 'Eiche', 'de'));
    cur = take(cur, setOptionHintOp(cur.effective(), 'baum', made.key, 'eiche', 'Quercus', 'de'));
    cur = take(cur, changeTypeOp(cur.effective(), 'baum', made.key, 'multiselect', ['baum']));
    expect(cur.effective().types?.['baum']?.properties[made.key]).toMatchObject({
      type: 'multiselect',
      option_hints: { eiche: { de: 'Quercus' } },
    });
  });
});
