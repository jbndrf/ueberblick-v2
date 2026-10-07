// WP-336: the task pane's edits as Doc ops, and what they mean to core (`available`).
import { describe, expect, it } from 'vitest';
import type { Actor, Key } from '@ueberblick/core';
import { applyOps, openProject, type Doc, type Op } from '../../doc';
import { planEdit } from '../../lenses/task/edit';
import { openSimulation } from '../../simulate';
import { musterstadt } from '../../testing/golden';
import {
  conditionOps,
  createRoleOps,
  deleteOps,
  dependentRules,
  descriptionOps,
  entryOps,
  labelOps,
  rolesOps,
  stageOps,
  stagePropertyOf,
} from './ops';

const open = (): Doc => openProject(musterstadt.templateSrc, musterstadt.overlaySrc);

function run(doc: Doc, ops: readonly Op[] | undefined): Doc {
  if (ops === undefined) throw new Error('not editable');
  const r = applyOps(doc, ops);
  if ('refused' in r) throw new Error(r.refused.message);
  return r.doc;
}

/** A new task offered on trees, as the catalog's Schaltfläche chip makes it. */
const withTask = (doc: Doc, extra: Record<string, unknown> = {}): Doc =>
  run(doc, [{ kind: 'add', path: 'tasks.neu', value: { label: { de: 'Neu' }, on: 'baum', ...extra } }]);

const actor = (id: string, roles: string[]): Actor => ({ id, kind: 'participant', roles: roles as Key[] });

function offered(doc: Doc, who: Actor, stage = 'erfasst'): boolean {
  const opened = openSimulation(doc.effective());
  if (!opened.ok) throw new Error(JSON.stringify(opened.problems));
  const sim = opened.simulation;
  const id = sim.generate('baum' as Key, { stage });
  return sim.availability(id, who).find((a) => a.task === 'neu')?.ok === true;
}

describe('label and description', () => {
  it('writes the label in the builder language and keeps the other languages', () => {
    const doc = run(open(), labelOps(open(), 'kontrolle', 'de', 'Kontrolle jetzt'));
    expect(doc.effective().tasks?.['kontrolle']?.label).toEqual({
      de: 'Kontrolle jetzt',
      en: 'Routine inspection',
    });
  });

  it('an empty label is refused (the label is required)', () => {
    expect(labelOps(open(), 'kontrolle', 'de', '   ')).toEqual([]);
  });

  it('writes, edits and removes the description', () => {
    let doc = run(open(), descriptionOps(open(), 'kontrolle', 'de', 'Sicht und Hammerprobe'));
    expect(doc.effective().tasks?.['kontrolle']?.description).toEqual({ de: 'Sicht und Hammerprobe' });
    doc = run(doc, descriptionOps(doc, 'kontrolle', 'de', ''));
    expect(doc.effective().tasks?.['kontrolle']?.description).toBeUndefined();
  });
});

describe('Einstiegs-Task', () => {
  it('turns a task into one that starts from the map, and back', () => {
    let doc = withTask(open());
    doc = run(doc, entryOps(doc, 'neu', 'baum', true));
    expect(doc.effective().tasks?.['neu']).toMatchObject({ on: '$map', creates: 'baum' });
    expect(doc.problems().filter((p) => p.path.startsWith('tasks.neu'))).toEqual([]);
    doc = run(doc, entryOps(doc, 'neu', 'baum', false));
    const t = doc.effective().tasks?.['neu'];
    expect(t?.on).toBe('baum');
    expect(t?.creates).toBeUndefined();
  });
});

describe('Wer darf dies nutzen', () => {
  it('without `who` no person may run the task; two roles: core offers it to exactly those roles', () => {
    let doc = withTask(open());
    expect(offered(doc, actor('v', ['verwaltung']))).toBe(false);
    doc = run(doc, rolesOps(doc, 'neu', ['kontrolle', 'bauhof']));
    expect(doc.effective().tasks?.['neu']?.who).toEqual(['kontrolle', 'bauhof']);
    expect(doc.effective().tasks?.['neu']?.when).toBeUndefined();
    expect(doc.problems().filter((p) => p.path.startsWith('tasks.neu'))).toEqual([]);
    expect(offered(doc, actor('a', ['kontrolle']))).toBe(true);
    expect(offered(doc, actor('b', ['bauhof']))).toBe(true);
    expect(offered(doc, actor('v', ['verwaltung']))).toBe(false);
  });

  it('keeps the condition when the roles change; removing every role offers it to nobody again', () => {
    let doc = withTask(open(), { when: "self.stage == 'erfasst'" });
    doc = run(doc, rolesOps(doc, 'neu', ['bauhof']));
    expect(doc.effective().tasks?.['neu']?.who).toEqual(['bauhof']);
    expect(doc.effective().tasks?.['neu']?.when).toBe("self.stage == 'erfasst'");
    expect(offered(doc, actor('b', ['bauhof']))).toBe(true);
    expect(offered(doc, actor('b', ['bauhof']), 'erledigt')).toBe(false);
    doc = run(doc, rolesOps(doc, 'neu', []));
    expect(doc.effective().tasks?.['neu']?.who).toBeUndefined();
    expect(doc.effective().tasks?.['neu']?.when).toBe("self.stage == 'erfasst'");
    expect(offered(doc, actor('b', ['bauhof']))).toBe(false);
  });

  it('`admin` is a choice next to the roles', () => {
    let doc = withTask(open());
    doc = run(doc, rolesOps(doc, 'neu', ['admin']));
    expect(doc.effective().tasks?.['neu']?.who).toEqual(['admin']);
    expect(doc.problems().filter((p) => p.path.startsWith('tasks.neu'))).toEqual([]);
  });

  it('edits the roles of a template task and brings them back to the template', () => {
    let doc = open();
    const who = (): readonly string[] | undefined => doc.effective().tasks?.['befund_ergaenzen']?.who;
    expect(who()).toEqual(['kontrolle']);
    doc = run(doc, rolesOps(doc, 'befund_ergaenzen', ['kontrolle', 'bauhof']));
    expect(who()).toEqual(['kontrolle', 'bauhof']);
    doc = run(doc, rolesOps(doc, 'befund_ergaenzen', ['bauhof']));
    expect(who()).toEqual(['bauhof']);
  });

  it('a task that creates also writes the type permission `create` (A-009)', () => {
    let doc = withTask(open(), { on: '$map', creates: 'baum' });
    const before = doc.effective().types?.['baum']?.permissions?.create;
    expect(before).toEqual(['kontrolle', 'verwaltung']);
    doc = run(doc, rolesOps(doc, 'neu', ['kontrolle', 'bauhof']));
    expect(doc.effective().types?.['baum']?.permissions?.create).toEqual([
      'kontrolle',
      'verwaltung',
      'bauhof',
    ]);
    doc = run(doc, rolesOps(doc, 'neu', ['bauhof']));
    expect(doc.effective().types?.['baum']?.permissions?.create).toEqual(['verwaltung', 'bauhof']);
  });
});

describe('the phase a task is offered in', () => {
  it('finds the stage property of the type the task is offered on', () => {
    expect(stagePropertyOf(open().effective(), 'kontrolle', 'baum')).toBe('stage');
    expect(stagePropertyOf(open().effective(), 'baumart_anlegen', 'baum')).toBe('stage');
  });

  it('pins the task to a stage, and core offers it only there', () => {
    let doc = withTask(open(), { who: ['verwaltung'] });
    doc = run(doc, stageOps(doc, 'neu', 'stage', 'massnahme'));
    expect(doc.effective().tasks?.['neu']?.when).toBe("self.stage == 'massnahme'");
    expect(offered(doc, actor('v', ['verwaltung']), 'massnahme')).toBe(true);
    expect(offered(doc, actor('v', ['verwaltung']), 'erfasst')).toBe(false);
    doc = run(doc, stageOps(doc, 'neu', 'stage', undefined));
    expect(doc.effective().tasks?.['neu']?.when).toBeUndefined();
  });
});

describe('Bedingungen', () => {
  it('adding and removing a chip changes `when`; the roles (`who`) stay', () => {
    let doc = withTask(open(), { who: ['bauhof'] });
    const plan = (src: string) => {
      const p = planEdit(doc, conditionOps(doc, 'neu', src), 'tasks.neu.when', 'de');
      if (!p.ok) throw new Error(p.reason);
      return p;
    };
    doc = plan('self.hoehe_m > 3').doc;
    expect(doc.effective().tasks?.['neu']?.when).toBe('self.hoehe_m > 3');
    doc = plan("self.hoehe_m > 3 && self.stage != 'erledigt'").doc;
    expect(doc.effective().tasks?.['neu']?.when).toBe("self.hoehe_m > 3 && self.stage != 'erledigt'");
    doc = plan('').doc;
    expect(doc.effective().tasks?.['neu']?.when).toBeUndefined();
    expect(doc.effective().tasks?.['neu']?.who).toEqual(['bauhof']);
  });

  it('an invalid expression is reported by the planner, in place, and applies nothing', () => {
    const doc = withTask(open());
    const plan = planEdit(doc, conditionOps(doc, 'neu', 'self.gibts_nicht > 3'), 'tasks.neu.when', 'de');
    expect(plan.ok).toBe(false);
    if (!plan.ok && plan.reason === 'problem') expect(plan.message.length).toBeGreaterThan(0);
    const bad = planEdit(doc, conditionOps(doc, 'neu', 'self.hoehe_m >'), 'tasks.neu.when', 'de');
    expect(bad.ok).toBe(false);
  });
});

describe('delete', () => {
  it('lists the rules that run the task', () => {
    expect(dependentRules(open().effective(), 'massnahme_anlegen')).toEqual([
      'massnahme_anlegen.massnahme_bei_schaden',
    ]);
    expect(dependentRules(open().effective(), 'kontrolle')).toEqual([
      'massnahme_anlegen.massnahme_bei_schaden',
    ]);
  });

  it('removes an added task, and hides one of the template', () => {
    let doc = withTask(open());
    doc = run(doc, deleteOps(doc, 'neu'));
    expect(doc.effective().tasks?.['neu']).toBeUndefined();
    doc = run(doc, deleteOps(doc, 'befund_ergaenzen'));
    expect(doc.effective().tasks?.['befund_ergaenzen']).toBeUndefined();
  });

  it('a task listed in an overlay `order` (after a reorder on the canvas) can still be deleted', () => {
    const keys = Object.keys(open().effective().tasks ?? {});
    const ordered = run(open(), [{ kind: 'order', path: 'tasks', keys: [...keys].reverse() }]);
    expect(applyOps(ordered, [{ kind: 'hide', path: 'tasks.verschieben' }])).toHaveProperty('refused');
    const doc = run(ordered, deleteOps(ordered, 'verschieben'));
    expect(doc.effective().tasks?.['verschieben']).toBeUndefined();
    expect(doc.overlay().order?.['tasks']).not.toContain('verschieben');
    expect(deleteOps(open(), 'verschieben').some((op) => op.kind === 'order')).toBe(false);
  });

  it('an automatic action that follows the deleted task shows as a problem', () => {
    const doc = run(open(), deleteOps(open(), 'kontrolle'));
    expect(
      doc.problems().some((p) => p.path.startsWith('tasks.massnahme_anlegen.auto.massnahme_bei_schaden')),
    ).toBe(true);
  });
});

describe('a new role from the picker', () => {
  it('adds the role to the file with the key made from its name', () => {
    const doc = open();
    const made = createRoleOps(doc.effective(), 'de', 'Gärtner Team');
    expect(made.key).toBe('gaertner_team');
    const next = run(doc, made.ops);
    expect(next.effective().roles?.['gaertner_team']?.label).toEqual({ de: 'Gärtner Team' });
  });
});
