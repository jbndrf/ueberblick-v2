// WP-435: move or copy a task step (a tool icon of the canvas) between two buttons.
import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc, type Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import { musterstadt } from '../../testing/golden';
import { stepList } from '../task/step-ops';
import { copyStepOps, STEP_COPY_REFUSALS } from './step-copy';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function apply(doc: Doc, ops: readonly Op[], scope: string): Doc {
  const plan = planEdit(doc, ops, scope, 'de');
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  const r = applyOps(doc, plan.ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}
const kinds = (doc: Doc, task: string) => stepList(doc.effective(), task).map((s) => s.kind);
const task = (doc: Doc, key: string) => doc.effective().tasks?.[key];

describe('a task step moves or is copied to another button', () => {
  it('moves a quick edit: the step leaves the source and ends up last in the target', () => {
    const doc = open();
    const r = copyStepOps(doc, 'baum_bearbeiten', 0, 'befund_ergaenzen', false, 'baum');
    if (!r.ok) throw new Error(r.reason);
    const next = apply(doc, r.ops, 'tasks.befund_ergaenzen');
    expect(kinds(next, 'befund_ergaenzen')).toEqual(['form', 'quick_edit']);
    expect(kinds(next, 'baum_bearbeiten')).toEqual(['location']);
    expect(stepList(next.effective(), 'befund_ergaenzen')[1]).toEqual({
      kind: 'quick_edit',
      properties: ['beschreibung'],
    });
  });

  it('copies it with Alt: the source keeps its step', () => {
    const doc = open();
    const r = copyStepOps(doc, 'baum_bearbeiten', 0, 'befund_ergaenzen', true, 'baum');
    if (!r.ok) throw new Error(r.reason);
    const next = apply(doc, r.ops, 'tasks.befund_ergaenzen');
    expect(kinds(next, 'baum_bearbeiten')).toEqual(['quick_edit', 'location']);
    expect(kinds(next, 'befund_ergaenzen')).toEqual(['form', 'quick_edit']);
  });

  it('moves a form with its fields to a task without one; a copy keeps the fields in both', () => {
    // `system_faellig` runs automatically: its `then` gives the required geometry a value (an automatic run has no form)
    const doc = open().apply({
      kind: 'set',
      path: 'tasks.system_faellig.then',
      value: [{ set: { kontrolle_faellig: true } }, { set: { geometrie: 'self.geometrie' } }],
    }).doc;
    const fields = Object.keys(task(doc, 'verschieben')?.form ?? {});
    expect(fields.length).toBeGreaterThan(0);
    const copied = copyStepOps(doc, 'verschieben', 0, 'system_faellig', true, 'baum');
    if (!copied.ok) throw new Error(copied.reason);
    const next = apply(doc, copied.ops, 'tasks.system_faellig');
    expect(kinds(next, 'system_faellig')).toEqual(['form']);
    expect(Object.keys(task(next, 'system_faellig')?.form ?? {})).toEqual(fields);
    expect(task(next, 'verschieben')?.form).toBeDefined();
    const moved = copyStepOps(doc, 'verschieben', 0, 'system_faellig', false, 'baum');
    if (!moved.ok) throw new Error(moved.reason);
    const after = apply(doc, moved.ops, 'tasks.system_faellig');
    expect(task(after, 'verschieben')?.form).toBeUndefined();
    expect(Object.keys(task(after, 'system_faellig')?.form ?? {})).toEqual(fields);
  });

  it('refuses a form for a task that already has one, the same button, and an unknown step', () => {
    const doc = open();
    expect(copyStepOps(doc, 'kontrolle', 0, 'befund_ergaenzen', false, 'baum')).toEqual({
      ok: false,
      reason: STEP_COPY_REFUSALS.hasForm,
    });
    expect(copyStepOps(doc, 'kontrolle', 0, 'kontrolle', true, 'baum')).toEqual({
      ok: false,
      reason: STEP_COPY_REFUSALS.same,
    });
    expect(copyStepOps(doc, 'kontrolle', 5, 'baum_bearbeiten', true, 'baum')).toEqual({
      ok: false,
      reason: STEP_COPY_REFUSALS.unknown,
    });
    expect(copyStepOps(doc, 'kontrolle', 0, 'gibt_es_nicht', true, 'baum')).toEqual({
      ok: false,
      reason: STEP_COPY_REFUSALS.unknown,
    });
  });

  it('refuses a quick edit whose property the target already writes, or that its type does not have', () => {
    const doc = open();
    // `erfassen` writes `beschreibung` in its form: a quick edit of it would be a second writer.
    expect(task(doc, 'erfassen')?.form).toHaveProperty('beschreibung');
    expect(copyStepOps(doc, 'baum_bearbeiten', 0, 'erfassen', true, 'baum')).toEqual({
      ok: false,
      reason: STEP_COPY_REFUSALS.property,
    });
    // another Objektart does not have the property
    expect(copyStepOps(doc, 'baum_bearbeiten', 0, 'flaeche_bearbeiten', true, 'baum')).toEqual({
      ok: false,
      reason: STEP_COPY_REFUSALS.property,
    });
  });
});
