// WP-352: the Formular tab's edits (steps) as Doc ops, checked by core (`planEdit` finds no new problem).
import { describe, expect, it } from 'vitest';
import { openProject, type Doc, type Op } from '../../doc';
import { addFieldOps, planEdit } from '../../lenses/task/edit';
import { musterstadt } from '../../testing/golden';
import {
  addStepOps,
  moveStepOps,
  removeStepOps,
  replaceStepOps,
  stepCandidates,
  stepList,
  subjectTypeOf,
} from './step-ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

/** Plans the ops like the pane does (a refusal or a new problem fails the test) and returns the new Doc. */
function commit(doc: Doc, task: string, ops: readonly Op[]): Doc {
  const plan = planEdit(doc, ops, `tasks.${task}`, 'de');
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  const r = doc.applyBatch(plan.ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}

const task = (doc: Doc, key: string) => doc.effective().tasks?.[key];

describe('Formular: add, reorder and remove steps of each kind', () => {
  it('a task with only its form lists the form step and omits `steps`', () => {
    expect(stepList(open().effective(), 'befund_ergaenzen')).toEqual([{ kind: 'form' }]);
    expect(task(open(), 'befund_ergaenzen')?.steps).toBeUndefined();
  });

  it('"+ Schnellbearbeitung" and "+ Standort" append in order; the YAML shows `steps`', () => {
    let doc = open();
    doc = commit(
      doc,
      'befund_ergaenzen',
      addStepOps(doc, 'befund_ergaenzen', { kind: 'quick_edit', properties: ['hoehe_m'] }),
    );
    doc = commit(
      doc,
      'befund_ergaenzen',
      addStepOps(doc, 'befund_ergaenzen', { kind: 'location', property: 'geometrie' }),
    );
    expect(task(doc, 'befund_ergaenzen')?.steps).toEqual([
      { kind: 'form' },
      { kind: 'quick_edit', properties: ['hoehe_m'] },
      { kind: 'location', property: 'geometrie' },
    ]);
    expect(doc.entityYaml('tasks.befund_ergaenzen').text).toMatch(
      /steps:[\s\S]*kind: form[\s\S]*kind: quick_edit[\s\S]*kind: location/,
    );
  });

  it('↑ and ↓ move a step, and the first and last cannot leave the list', () => {
    let doc = open();
    doc = commit(
      doc,
      'befund_ergaenzen',
      addStepOps(doc, 'befund_ergaenzen', { kind: 'quick_edit', properties: ['hoehe_m'] }),
    );
    doc = commit(doc, 'befund_ergaenzen', moveStepOps(doc, 'befund_ergaenzen', 1, -1));
    expect(task(doc, 'befund_ergaenzen')?.steps?.map((s) => s.kind)).toEqual(['quick_edit', 'form']);
    expect(moveStepOps(doc, 'befund_ergaenzen', 0, -1)).toEqual([]);
    expect(moveStepOps(doc, 'befund_ergaenzen', 1, 1)).toEqual([]);
    doc = commit(doc, 'befund_ergaenzen', moveStepOps(doc, 'befund_ergaenzen', 0, 1));
    expect(task(doc, 'befund_ergaenzen')?.steps?.map((s) => s.kind)).toEqual(['form', 'quick_edit']);
  });

  it('removing the other steps leaves the task its form and drops `steps`', () => {
    let doc = open();
    doc = commit(
      doc,
      'befund_ergaenzen',
      addStepOps(doc, 'befund_ergaenzen', { kind: 'quick_edit', properties: ['hoehe_m'] }),
    );
    doc = commit(doc, 'befund_ergaenzen', removeStepOps(doc, 'befund_ergaenzen', 1));
    expect(task(doc, 'befund_ergaenzen')?.steps).toBeUndefined();
    expect(task(doc, 'befund_ergaenzen')?.form).toBeDefined();
  });

  it('a task without a form gets one with "+ Formular"; removing the form step takes the form', () => {
    let doc = open();
    expect(task(doc, 'system_faellig')?.form).toBeUndefined();
    doc = commit(doc, 'system_faellig', addStepOps(doc, 'system_faellig', { kind: 'form' }));
    expect(task(doc, 'system_faellig')?.form).toEqual({});
    expect(task(doc, 'system_faellig')?.steps).toBeUndefined();
    doc = commit(
      doc,
      'system_faellig',
      addStepOps(doc, 'system_faellig', { kind: 'quick_edit', properties: ['hoehe_m'] }),
    );
    doc = commit(doc, 'system_faellig', removeStepOps(doc, 'system_faellig', 0));
    expect(task(doc, 'system_faellig')?.form).toBeUndefined();
    expect(task(doc, 'system_faellig')?.steps).toEqual([{ kind: 'quick_edit', properties: ['hoehe_m'] }]);
  });

  it('a second form step is refused by core and not applied', () => {
    const doc = open();
    const plan = planEdit(
      doc,
      addStepOps(doc, 'befund_ergaenzen', { kind: 'form' }),
      'tasks.befund_ergaenzen',
      'de',
    );
    expect(plan.ok).toBe(false);
  });

  it('a property written by two steps is refused', () => {
    const doc = open();
    const ops = addStepOps(doc, 'befund_ergaenzen', { kind: 'quick_edit', properties: ['befund'] });
    expect(planEdit(doc, ops, 'tasks.befund_ergaenzen', 'de').ok).toBe(false);
  });

  it('replacing the picked properties of a quick edit rewrites that step only', () => {
    let doc = open();
    doc = commit(
      doc,
      'befund_ergaenzen',
      addStepOps(doc, 'befund_ergaenzen', { kind: 'quick_edit', properties: ['hoehe_m'] }),
    );
    doc = commit(
      doc,
      'befund_ergaenzen',
      replaceStepOps(doc, 'befund_ergaenzen', 1, {
        kind: 'quick_edit',
        properties: ['hoehe_m', 'hoehe_klasse'],
      }),
    );
    expect(task(doc, 'befund_ergaenzen')?.steps?.[1]).toEqual({
      kind: 'quick_edit',
      properties: ['hoehe_m', 'hoehe_klasse'],
    });
  });
});

describe('the pickers', () => {
  it('quick edit offers the subject properties no step or form writes, without geometries and the stage', () => {
    const keys = stepCandidates(open().effective(), 'befund_ergaenzen', 'baum', 'de', 'quick_edit').map(
      (c) => c.key,
    );
    expect(keys).toContain('hoehe_m');
    expect(keys).toContain('zustaendig');
    expect(keys).not.toContain('befund');
    expect(keys).not.toContain('geometrie');
    expect(keys).not.toContain('stage');
  });

  it('Standort offers only geometry properties', () => {
    const c = stepCandidates(open().effective(), 'befund_ergaenzen', 'baum', 'de', 'location');
    expect(c.map((x) => x.key)).toEqual(['geometrie']);
    expect(c[0]?.label).toBe('Standort');
  });

  it('the subject type is what the task creates, else its first `on` type', () => {
    const file = open().effective();
    expect(subjectTypeOf(file, 'massnahme_anlegen', 'x')).toBe('massnahme');
    expect(subjectTypeOf(file, 'befund_ergaenzen', 'x')).toBe('baum');
  });
});

describe('Formular löschen drops the order of the form it removes (WP-477)', () => {
  it('an order op under tasks.<t>.form does not outlive the form', () => {
    let doc = open();
    doc = commit(doc, 'befund_ergaenzen', addFieldOps(doc, 'befund_ergaenzen', 'hoehe_m'));
    const form = Object.keys(task(doc, 'befund_ergaenzen')?.form ?? {});
    expect(form.length).toBeGreaterThan(1);
    const ordered = doc.apply({
      kind: 'order',
      path: 'tasks.befund_ergaenzen.form',
      keys: [...form].reverse(),
    });
    expect(ordered.refused).toBeUndefined();
    doc = ordered.doc;
    doc = commit(doc, 'befund_ergaenzen', removeStepOps(doc, 'befund_ergaenzen', 0));
    expect(task(doc, 'befund_ergaenzen')?.form).toBeUndefined();
    expect(doc.overlay().order?.['tasks.befund_ergaenzen.form']).toBeUndefined();
    expect(doc.problems().filter((p) => p.code === 'unknown_path')).toEqual([]);
  });
});
