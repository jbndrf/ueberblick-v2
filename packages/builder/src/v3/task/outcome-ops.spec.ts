// WP-352: the Ergebnisse tab's edits (then steps, creates, "Übergang zu") as Doc ops.
import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc, type Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import { connectOps } from '../../lenses/process/edit';
import { buildCanvas, CANVAS_ORIGINS } from '../canvas/model';
import { musterstadt } from '../../testing/golden';
import {
  addOutcomeOps,
  createTypeOps,
  moveOutcomeOps,
  outcomeRows,
  removeCreateOps,
  removeOutcomeOps,
  setLifecycleOps,
  setPropertyOps,
  setStepWhenOps,
  setValueOps,
  transitionOps,
  transitionTarget,
  whenModeOf,
} from './outcome-ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const T = 'befund_ergaenzen';

function commit(doc: Doc, task: string, ops: readonly Op[]): Doc {
  const plan = planEdit(doc, ops, `tasks.${task}`, 'de');
  if (!plan.ok) throw new Error(JSON.stringify(plan));
  const r = applyOps(doc, plan.ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}

function added(doc: Doc, task: string, kind: Parameters<typeof addOutcomeOps>[3]): Doc {
  const r = addOutcomeOps(doc, task, 'baum', kind);
  if (!r.ok) throw new Error(r.reason);
  return commit(doc, task, r.ops);
}

function tr(doc: Doc, to: string | undefined): readonly Op[] {
  const r = transitionOps(doc, T, 'baum', to);
  if (!r.ok) throw new Error(r.reason);
  return r.ops;
}

const then = (doc: Doc, task = T) => doc.effective().tasks?.[task]?.then;

describe('Übergang zu and the canvas arrow are one op', () => {
  it('writes the same step the process lens writes for an arrow', () => {
    const doc = open();
    const ours = transitionOps(doc, T, 'baum', 'kontrolliert');
    const theirs = connectOps(doc.effective(), {
      type: 'baum',
      property: 'stage',
      to: 'kontrolliert',
      carrier: { task: T },
    });
    expect(ours.ok && theirs.ok && ours.ops).toEqual(theirs.ok ? theirs.ops : undefined);
  });

  it('the canvas then draws the arrow, and the tab reads the target back', () => {
    const doc = commit(open(), T, tr(open(), 'kontrolliert'));
    expect(then(doc)).toEqual([{ set: { stage: "'kontrolliert'" } }]);
    const arrows = buildCanvas(doc, 'baum', 'de').arrows.filter(
      (a) => a.origin === CANVAS_ORIGINS.task && a.handle === T,
    );
    expect(arrows.map((a) => a.target)).toEqual(['stage:kontrolliert']);
    expect(transitionTarget(doc.effective(), T, 'baum')).toBe('kontrolliert');
  });

  it('retargets and removes the arrow; "Kein Übergang" leaves no step', () => {
    let doc = commit(open(), T, tr(open(), 'kontrolliert'));
    doc = commit(doc, T, tr(doc, 'erledigt'));
    expect(transitionTarget(doc.effective(), T, 'baum')).toBe('erledigt');
    doc = commit(doc, T, tr(doc, undefined));
    expect(then(doc)).toBeUndefined();
    expect(transitionOps(doc, T, 'baum', undefined)).toEqual({ ok: true, ops: [] });
  });

  it('the transition step is not a row of the action list; other steps are', () => {
    let doc = commit(open(), T, tr(open(), 'kontrolliert'));
    doc = added(doc, T, 'lifecycle');
    expect(outcomeRows(doc.effective(), T, 'baum').map((r) => [r.index, r.kind])).toEqual([[1, 'lifecycle']]);
  });

  it('a type without a process has no transition', () => {
    expect(transitionOps(open(), 'massnahme_erledigen', 'massnahme', 'x')).toEqual({
      ok: false,
      reason: 'no_process',
    });
  });
});

describe('each action kind writes its then step', () => {
  it('set (a literal and an expression), clear and status', () => {
    let doc = added(open(), T, 'set');
    expect(then(doc)).toEqual([{ set: { befund: "''" } }]);
    doc = commit(doc, T, setPropertyOps(doc, T, 'baum', 0, 'hoehe_m'));
    expect(then(doc)).toEqual([{ set: { hoehe_m: 0 } }]);
    doc = commit(doc, T, setValueOps(doc, T, 0, '12.5'));
    expect(then(doc)?.[0]?.set).toEqual({ hoehe_m: 12.5 });
    doc = commit(doc, T, setValueOps(doc, T, 0, 'self.hoehe_m * 2'));
    expect(then(doc)?.[0]?.set).toEqual({ hoehe_m: 'self.hoehe_m * 2' });
    expect(outcomeRows(doc.effective(), T, 'baum')[0]?.kind).toBe('set');

    doc = added(doc, T, 'clear');
    expect(then(doc)?.[1]).toEqual({ set: { art: null } });
    expect(outcomeRows(doc.effective(), T, 'baum')[1]?.kind).toBe('clear');

    doc = added(doc, T, 'status');
    expect(then(doc)?.[2]).toEqual({ set: { vitalitaet: "'v0'" } });
    expect(outcomeRows(doc.effective(), T, 'baum')[2]?.kind).toBe('status');
    doc = commit(doc, T, setValueOps(doc, T, 2, "'v3'"));
    expect(then(doc)?.[2]?.set).toEqual({ vitalitaet: "'v3'" });
  });

  it('an expression the checker rejects is not applied and says why', () => {
    const doc = added(open(), T, 'set');
    const plan = planEdit(doc, setValueOps(doc, T, 0, 'self.gibts_nicht + 1'), `tasks.${T}`, 'de');
    expect(plan.ok).toBe(false);
  });

  it('an empty value is not written', () => {
    const doc = added(open(), T, 'set');
    expect(setValueOps(doc, T, 0, '  ')).toEqual([]);
  });

  it('lifecycle writes {lifecycle: state}', () => {
    let doc = added(open(), T, 'lifecycle');
    expect(then(doc)).toEqual([{ lifecycle: 'completed' }]);
    doc = commit(doc, T, setLifecycleOps(doc, T, 0, 'archived'));
    expect(then(doc)).toEqual([{ lifecycle: 'archived' }]);
  });

  it('create writes `creates`; a second create is refused', () => {
    const N = 'neu';
    let doc = commit(open(), N, [
      { kind: 'add', path: 'tasks.neu', value: { label: { de: 'Neu' }, on: 'baum' } },
    ]);
    doc = added(doc, N, 'create');
    expect(doc.effective().tasks?.[N]?.creates).toBe('baum');
    expect(addOutcomeOps(doc, N, 'baum', 'create')).toEqual({ ok: false, reason: 'second_create' });
    doc = commit(doc, N, createTypeOps(doc, N, 'massnahme'));
    expect(doc.effective().tasks?.[N]?.creates).toBe('massnahme');
    doc = commit(doc, N, removeCreateOps(doc, N));
    expect(doc.effective().tasks?.[N]?.creates).toBeUndefined();
  });

  it('a type without a select property has no "Status setzen"', () => {
    expect(addOutcomeOps(open(), 'baumart_anlegen', 'baumart', 'status')).toEqual({
      ok: false,
      reason: 'no_select',
    });
  });
});

describe('nur wenn, sonst, order and remove', () => {
  it('"nur wenn" round-trips through the file; "sonst" and "immer" replace it', () => {
    let doc = added(open(), T, 'lifecycle');
    expect(whenModeOf(then(doc)?.[0] as never)).toBe('always');
    doc = commit(doc, T, setStepWhenOps(doc, T, 0, 'when', 'self.hoehe_m > 3'));
    expect(then(doc)).toEqual([{ lifecycle: 'completed', when: 'self.hoehe_m > 3' }]);
    expect(whenModeOf(then(doc)?.[0] as never)).toBe('when');
    doc = commit(doc, T, setStepWhenOps(doc, T, 0, 'otherwise'));
    expect(then(doc)).toEqual([{ lifecycle: 'completed', otherwise: true }]);
    doc = commit(doc, T, setStepWhenOps(doc, T, 0, 'always'));
    expect(then(doc)).toEqual([{ lifecycle: 'completed' }]);
  });

  it('↑ and ↓ swap neighbouring rows; remove takes the step; the last remove drops `then`', () => {
    let doc = added(added(open(), T, 'lifecycle'), T, 'clear');
    const rows = () => outcomeRows(doc.effective(), T, 'baum');
    expect(rows().map((r) => r.kind)).toEqual(['lifecycle', 'clear']);
    doc = commit(doc, T, moveOutcomeOps(doc, T, rows(), 1, -1));
    expect(rows().map((r) => r.kind)).toEqual(['clear', 'lifecycle']);
    expect(moveOutcomeOps(doc, T, rows(), 0, -1)).toEqual([]);
    doc = commit(doc, T, removeOutcomeOps(doc, T, 0));
    doc = commit(doc, T, removeOutcomeOps(doc, T, 0));
    expect(then(doc)).toBeUndefined();
  });

  it('the golden kontrolle task lists its conditional steps as rows', () => {
    const rows = outcomeRows(open().effective(), 'kontrolle', 'baum');
    expect(rows.map((r) => r.step.otherwise === true || r.step.when !== undefined)).toContain(true);
  });
});
