// WP-446: stepsOps on a template task whose `steps` come from the template (clear = hide, set after hide).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { TaskStep } from '@ueberblick/core';
import { openProject, type Doc, type Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import { musterstadt } from '../../testing/golden';
import { addStepOps, moveStepOps, removeStepOps, stepsOps } from './step-ops';

const T = 'baum_bearbeiten';
const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function commit(doc: Doc, ops: readonly Op[]): Doc {
  const plan = planEdit(doc, ops, `tasks.${T}`, 'de');
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  const r = doc.applyBatch(plan.ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}
const steps = (d: Doc) => d.effective().tasks?.[T]?.steps;
const QE: TaskStep = { kind: 'quick_edit', properties: ['beschreibung'] };
const LOC: TaskStep = { kind: 'location', property: 'geometrie' };
const QE2: TaskStep = { kind: 'quick_edit', properties: ['art'] };

describe('template task with template steps', () => {
  it('starts from the template steps', () => {
    expect(steps(open())).toEqual([QE, LOC]);
  });

  it('adds a form step, removes it again, adds a quick edit, reorders', () => {
    let doc = open();
    doc = commit(doc, addStepOps(doc, T, { kind: 'form' }));
    expect(steps(doc)).toEqual([QE, LOC, { kind: 'form' }]);
    expect(doc.effective().tasks?.[T]?.form).toEqual({});
    doc = commit(doc, removeStepOps(doc, T, 2));
    expect(steps(doc)).toEqual([QE, LOC]);
    expect(doc.effective().tasks?.[T]?.form).toBeUndefined();
    doc = commit(doc, addStepOps(doc, T, QE2));
    expect(steps(doc)?.length).toBe(3);
    doc = commit(doc, moveStepOps(doc, T, 2, -1));
    expect(steps(doc)).toEqual([QE, QE2, LOC]);
  });

  it('removing every step, then adding one back, works', () => {
    let doc = open();
    doc = commit(doc, stepsOps(doc, T, []));
    expect(steps(doc)).toBeUndefined();
    doc = commit(doc, addStepOps(doc, T, LOC));
    expect(steps(doc)).toEqual([LOC]);
  });

  it('property: any step list reads back and no op is refused', () => {
    const step = fc.constantFrom<TaskStep>({ kind: 'form' }, QE, QE2, LOC);
    const valid = fc.array(step, { maxLength: 4 }).filter((l) => {
      const forms = l.filter((s) => s.kind === 'form').length;
      const props = l.flatMap((s) =>
        s.kind === 'quick_edit' ? s.properties : s.kind === 'location' ? [s.property] : [],
      );
      return forms <= 1 && new Set(props).size === props.length;
    });
    fc.assert(
      fc.property(fc.array(valid, { minLength: 1, maxLength: 4 }), (lists) => {
        let doc = open();
        for (const next of lists) {
          const r = doc.applyBatch(stepsOps(doc, T, next));
          expect('refused' in r).toBe(false);
          if ('refused' in r) return;
          doc = r.doc;
          // only `steps` and `form` are written: no task-level override, the rest stays the template's
          expect(Object.keys(doc.overlay().override ?? {})).not.toContain(`tasks.${T}`);
          expect(doc.provenance(`tasks.${T}.when`)).toBe('template');
          expect(doc.provenance(`tasks.${T}.label`)).toBe('template');
          const want = next.length === 1 && next[0]?.kind === 'form' ? [] : next;
          expect(doc.effective().tasks?.[T]?.steps ?? []).toEqual(want);
          expect(doc.effective().tasks?.[T]?.form !== undefined).toBe(next.some((s) => s.kind === 'form'));
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('the saved overlay of a stepsOps batch reopens to the same effective file (WP-446)', () => {
  const lists: readonly (readonly TaskStep[])[] = [[{ kind: 'form' }, QE2], [LOC], []];
  it.each(lists.map((l, i) => [i, l] as const))('list %i', (_i, next) => {
    const doc = open();
    const r = doc.applyBatch(stepsOps(doc, T, next));
    expect('doc' in r).toBe(true);
    if (!('doc' in r)) return;
    const again = openProject(musterstadt.templateSrc, r.doc.save().overlaySrc);
    expect(again.effective()).toEqual(r.doc.effective());
    expect(again.problems()).toEqual(r.doc.problems());
  });
});
