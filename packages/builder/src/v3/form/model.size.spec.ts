import { describe, expect, it } from 'vitest';
import { openProject, type Doc } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { editorModel, libraryOf } from './model';
import { stepOps } from './ops';

// Correctness on a form far past a real one; the timing is bench/builder-form (R14).
const FIELDS = 200;

function bigDoc(): Doc {
  let doc = openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
  for (let i = 0; i < FIELDS; i++) {
    doc = doc.apply({
      kind: 'add',
      path: `types.baum.properties.feld_${i}`,
      value: { type: 'text', label: { de: `Feld ${i}` } },
    }).doc;
  }
  const form = Object.fromEntries(Array.from({ length: FIELDS }, (_, i) => [`feld_${i}`, {}]));
  return doc.apply({ kind: 'add', path: 'tasks.gross', value: { label: { de: 'Gross' }, on: 'baum', form } })
    .doc;
}

describe('a form of 200 fields', () => {
  const doc = bigDoc();

  it('reads the model with every field once, and the library marks them used', () => {
    const model = editorModel(doc.effective(), 'gross', 'baum', 'de');
    expect(model.fields.size).toBe(FIELDS);
    expect(model.layout.pages).toHaveLength(1);
    expect(libraryOf(doc.effective(), 'gross', 'baum', 'de').filter((e) => e.used)).toHaveLength(FIELDS);
  });

  it('turns a move into one order op', () => {
    expect(stepOps(doc, 'gross', 'baum', 'feld_100', -1).map((o) => o.kind)).toEqual(['order']);
  });
});
