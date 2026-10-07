// WP-435: what the canvas gestures write, through the existing ops (R1). The spec asserts the op output.
import { describe, expect, it } from 'vitest';
import { applyOps, openProject, type Doc, type Op } from '../../doc';
import { musterstadt } from '../../testing/golden';
import { deleteOps } from '../task/ops';
import {
  addTaskOps,
  CANVAS_REFUSALS,
  drawArrow,
  nudgeOps,
  removeArrow,
  reorderOps,
  retargetArrow,
} from './edit';
import { buildCanvas, nodeId } from './model';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);
const model = (doc: Doc) => buildCanvas(doc, 'baum', 'de');
const names = {
  task: 'Neue Aufgabe',
  entry: 'Neuer Eingang',
  stage: 'Neue Phase',
  rule: 'Neue Regel',
  process: 'Phase',
  endStage: 'Ende',
};

function apply(doc: Doc, ops: readonly Op[]): Doc {
  const r = applyOps(doc, ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}
const taskKeys = (doc: Doc) => Object.keys(doc.effective().tasks ?? {});

describe('arrows', () => {
  it('draws an arrow from a task button on a phase to another phase: one `then` step with the phase `when`', () => {
    const added = addTaskOps(open().effective(), 'baum', 'massnahme', 'de', names);
    if (!added.ok) throw new Error('add');
    const doc = apply(open(), added.ops);
    const r = drawArrow(doc, model(doc), 'baum', {
      source: nodeId.stage('massnahme'),
      handle: added.key,
      target: nodeId.stage('erledigt'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const next = apply(doc, r.ops);
    expect(next.effective().tasks?.[added.key]?.then).toEqual([{ set: { stage: "'erledigt'" } }]);
    const arrows = model(next).arrows.filter((a) => a.handle === added.key);
    expect(arrows.map((a) => [a.source, a.target])).toEqual([
      [nodeId.stage('massnahme'), nodeId.stage('erledigt')],
    ]);
  });

  it('draws from the global container: the arrow starts in any phase', () => {
    const doc = open();
    const r = drawArrow(doc, model(doc), 'baum', {
      source: nodeId.global,
      handle: 'befund_ergaenzen',
      target: nodeId.stage('erledigt'),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const then = apply(doc, r.ops).effective().tasks?.['befund_ergaenzen']?.then;
    expect(then).toEqual([{ set: { stage: "'erledigt'" } }]);
  });

  it('refuses an arrow that is already there, one that does not end at a phase, and one from a rule or an entry', () => {
    const doc = open();
    const m = model(doc);
    const first = drawArrow(doc, m, 'baum', {
      source: nodeId.global,
      handle: 'befund_ergaenzen',
      target: nodeId.stage('erledigt'),
    });
    if (!first.ok) throw new Error('draw');
    const drawn = apply(doc, first.ops);
    const again = drawArrow(drawn, model(drawn), 'baum', {
      source: nodeId.global,
      handle: 'befund_ergaenzen',
      target: nodeId.stage('erledigt'),
    });
    expect(again).toEqual({ ok: false, reason: CANVAS_REFUSALS.exists });
    const noStage = drawArrow(doc, m, 'baum', {
      source: nodeId.global,
      handle: 'kontrolle',
      target: nodeId.global,
    });
    expect(noStage).toEqual({ ok: false, reason: CANVAS_REFUSALS.notStage });
    const fromRule = drawArrow(doc, m, 'baum', {
      source: nodeId.rule('massnahme_bei_schaden'),
      handle: 'massnahme_bei_schaden',
      target: nodeId.stage('erledigt'),
    });
    expect(fromRule).toEqual({ ok: false, reason: CANVAS_REFUSALS.notTask });
  });

  it('refuses a task that a `when` pins to another phase, with the lens reason', () => {
    const doc = open();
    const r = drawArrow(doc, model(doc), 'baum', {
      source: nodeId.stage('erfasst'),
      handle: 'massnahme_anlegen',
      target: nodeId.stage('erledigt'),
    });
    expect(r).toEqual({ ok: false, reason: CANVAS_REFUSALS.taskPinned });
  });

  it('a type without a process has no phase property: nothing is drawn', () => {
    const doc = open();
    const m = buildCanvas(doc, 'flaeche', 'de');
    const r = drawArrow(doc, m, 'flaeche', {
      source: nodeId.global,
      handle: 'flaeche_bearbeiten',
      target: nodeId.stage('x'),
    });
    expect(r).toEqual({ ok: false, reason: CANVAS_REFUSALS.noProcess });
  });

  it('retargets an arrow to another phase and removes it again; the button stays', () => {
    const doc = open();
    const m = model(doc);
    const arrow = m.arrows.find((a) => a.handle === 'kontrolle' && !a.otherwise);
    expect(arrow).toBeDefined();
    const moved = retargetArrow(doc, m, arrow?.id ?? '', nodeId.stage('erledigt'));
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const doc2 = apply(doc, moved.ops);
    expect(
      model(doc2)
        .arrows.filter((a) => a.handle === 'kontrolle')
        .map((a) => a.target),
    ).toContain(nodeId.stage('erledigt'));
    const m2 = model(doc2);
    const target = m2.arrows.find((a) => a.handle === 'kontrolle' && a.target === nodeId.stage('erledigt'));
    const gone = removeArrow(doc2, m2, target?.id ?? '');
    expect(gone.ok).toBe(true);
    if (!gone.ok) return;
    const doc3 = apply(doc2, gone.ops);
    expect(model(doc3).arrows.filter((a) => a.handle === 'kontrolle')).toHaveLength(
      m2.arrows.filter((a) => a.handle === 'kontrolle').length - 1,
    );
    expect(doc3.effective().tasks?.['kontrolle']).toBeDefined();
  });

  it('removing the only arrow of a task leaves no empty `then`', () => {
    const doc = open();
    const added = drawArrow(doc, model(doc), 'baum', {
      source: nodeId.global,
      handle: 'befund_ergaenzen',
      target: nodeId.stage('erledigt'),
    });
    if (!added.ok) throw new Error('draw');
    const doc2 = apply(doc, added.ops);
    const m = model(doc2);
    const id = m.arrows.find((a) => a.handle === 'befund_ergaenzen')?.id ?? '';
    const gone = removeArrow(doc2, m, id);
    if (!gone.ok) throw new Error('remove');
    expect(apply(doc2, gone.ops).effective().tasks?.['befund_ergaenzen']?.then).toBeUndefined();
  });

  it('an unknown or rule arrow cannot be retargeted or removed', () => {
    const doc = open();
    const m = model(doc);
    const rule = m.arrows.find((a) => a.origin === 'rule');
    expect(removeArrow(doc, m, rule?.id ?? 'x')).toEqual({ ok: false, reason: CANVAS_REFUSALS.notTask });
    expect(retargetArrow(doc, m, 'nope', nodeId.stage('erfasst'))).toEqual({
      ok: false,
      reason: CANVAS_REFUSALS.notTask,
    });
  });
});

describe('reorder the buttons of a scope (overlay order of tasks)', () => {
  const file = () => open().effective();
  const scope = ['kontrolle', 'befund_ergaenzen', 'verschieben'];
  const mine = (doc: Doc) => taskKeys(doc).filter((k) => scope.includes(k));

  it('puts a button before another; the other scopes keep their slots', () => {
    const ops = reorderOps(file(), scope, 'verschieben', 'kontrolle');
    expect(ops).toHaveLength(1);
    const next = apply(open(), ops);
    expect(mine(next)).toEqual(['verschieben', 'kontrolle', 'befund_ergaenzen']);
    const others = (doc: Doc) => taskKeys(doc).filter((k) => !scope.includes(k));
    expect(others(next)).toEqual(others(open()));
  });

  it('drops at the end when no button follows; no op when nothing moves', () => {
    const next = apply(open(), reorderOps(file(), scope, 'kontrolle', null));
    expect(mine(next)).toEqual(['befund_ergaenzen', 'verschieben', 'kontrolle']);
    expect(reorderOps(file(), scope, 'kontrolle', 'befund_ergaenzen')).toEqual([]);
    expect(reorderOps(file(), scope, 'kontrolle', 'kontrolle')).toEqual([]);
    expect(reorderOps(file(), scope, 'unknown', null)).toEqual([]);
  });

  it('the keyboard nudge is the same edit: one place up or down, none past the ends', () => {
    expect(nudgeOps(file(), scope, 'kontrolle', -1)).toEqual([]);
    expect(nudgeOps(file(), scope, 'verschieben', 1)).toEqual([]);
    expect(mine(apply(open(), nudgeOps(file(), scope, 'kontrolle', 1)))).toEqual([
      'befund_ergaenzen',
      'kontrolle',
      'verschieben',
    ]);
    expect(mine(apply(open(), nudgeOps(file(), scope, 'verschieben', -1)))).toEqual([
      'kontrolle',
      'verschieben',
      'befund_ergaenzen',
    ]);
    expect(nudgeOps(file(), scope, 'kontrolle', 1)).toEqual(
      reorderOps(file(), scope, 'kontrolle', 'verschieben'),
    );
  });

  it('the canvas shows the new order (the model reads the file order)', () => {
    const next = apply(open(), reorderOps(file(), scope, 'verschieben', 'kontrolle'));
    expect(
      model(next)
        .global.map((t) => t.key)
        .filter((k) => scope.includes(k)),
    ).toEqual(['verschieben', 'kontrolle', 'befund_ergaenzen']);
  });

  it('a button that was moved can still be deleted afterwards', () => {
    const doc = apply(open(), reorderOps(file(), scope, 'verschieben', 'kontrolle'));
    const next = apply(doc, deleteOps(doc, 'verschieben'));
    expect(taskKeys(next)).not.toContain('verschieben');
  });
});

describe('add a button', () => {
  it('in a phase: a task pinned to it by its `when`', () => {
    const r = addTaskOps(open().effective(), 'baum', 'massnahme', 'de', names);
    if (!r.ok) throw new Error('add');
    const next = apply(open(), r.ops);
    expect(next.effective().tasks?.[r.key]?.when).toBe("self.stage == 'massnahme'");
    expect(
      model(next)
        .stages.find((s) => s.key === 'massnahme')
        ?.tasks.map((t) => t.key),
    ).toContain(r.key);
  });

  it('in the global container: a task without a condition; the form chip adds a form', () => {
    const r = addTaskOps(open().effective(), 'baum', null, 'de', names, true);
    if (!r.ok) throw new Error('add');
    const task = apply(open(), r.ops).effective().tasks?.[r.key];
    expect(task?.when).toBeUndefined();
    expect(task?.form).toEqual({});
    const staged = addTaskOps(open().effective(), 'baum', 'erfasst', 'de', names, true);
    if (!staged.ok) throw new Error('add');
    expect(apply(open(), staged.ops).effective().tasks?.[staged.key]?.form).toEqual({});
  });

  it('a type without a process takes no button in a phase', () => {
    expect(addTaskOps(open().effective(), 'flaeche', 'x', 'de', names)).toEqual({
      ok: false,
      reason: 'no_process',
    });
  });
});
