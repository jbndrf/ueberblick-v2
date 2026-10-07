/**
 * Budget (WP-380, R14): the form editor's edit-to-update on a form of 200 fields (far past a real form). The editor
 * reads the editor model and the library on every edit, and an edit is one pass of `layoutOps` (dominated by one
 * `Doc.apply`). Desktop tooling: docs/12 has no builder row, the bar is one interaction, well below 300 ms.
 * Run: npm run bench -- bench/builder-form
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { openProject, type Doc } from '../../packages/builder/src/doc';
import { musterstadt } from '../../packages/builder/src/testing/golden';
import { editorModel, libraryOf } from '../../packages/builder/src/v3/form/model';
import { stepOps } from '../../packages/builder/src/v3/form/ops';

const FIELDS = 200;
const best = (f: () => void, n = 7): number => {
  let m = Infinity;
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    f();
    m = Math.min(m, performance.now() - t);
  }
  return m;
};

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

const doc = bigDoc();
const budget = (id: string, limit: number) =>
  defineBudget({
    id,
    limit,
    unit: 'ms',
    derivedFrom:
      'interaction-to-next-paint: builder edit on a 200-field form; desktop tooling, not a device budget',
    device: 'dev-only',
    thread: 'main',
  });

describe('form editor on 200 fields', () => {
  it('reads the editor model and the library', () => {
    const ms = best(() => {
      editorModel(doc.effective(), 'gross', 'baum', 'de');
      libraryOf(doc.effective(), 'gross', 'baum', 'de');
    });
    console.info(`form editor model + library, ${FIELDS} fields: ${ms.toFixed(1)} ms`);
    assertBudget(report(budget('builder-form-model', 100), Number(ms.toFixed(1))));
  });

  it('turns a move into ops', () => {
    let ops: readonly { kind: string }[] = [];
    const ms = best(() => {
      ops = stepOps(doc, 'gross', 'baum', 'feld_100', -1);
    });
    expect(ops.map((o) => o.kind)).toEqual(['order']);
    console.info(`form editor move op, ${FIELDS} fields: ${ms.toFixed(1)} ms`);
    assertBudget(report(budget('builder-form-move', 250), Number(ms.toFixed(1))));
  });
});
