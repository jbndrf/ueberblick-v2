import { describe, expect, it } from 'vitest';
import type { Doc, Op } from '../../doc';
import { connectOps, newTaskKey, removeOps, retargetOps, type EditResult } from './edit';
import { deriveProcesses } from './graph';
import { goldenDoc, must } from './fixtures';

const open = () => goldenDoc('baumkataster', '2.0.0');
const stageOf = (doc: Doc) => must(deriveProcesses(doc.effective(), 'baum')[0]);

function run(doc: Doc, r: EditResult): Doc {
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  let d = doc;
  for (const op of r.ops as readonly Op[]) {
    const a = d.apply(op);
    expect(a.refused).toBeUndefined();
    d = a.doc;
  }
  return d;
}

describe('drawing an arrow', () => {
  it('on an existing task appends the expected then step with the source as the step condition', () => {
    const doc = open();
    const r = connectOps(doc.effective(), {
      type: 'baum',
      property: 'stage',
      from: 'massnahme',
      to: 'erledigt',
      carrier: { task: 'zuweisen' },
    });
    expect(r).toEqual({
      ok: true,
      ops: [
        {
          kind: 'set', // zuweisen has no `then` in the template: Doc.apply writes the list as an add
          path: 'tasks.zuweisen.then',
          value: [{ set: { stage: "'erledigt'" }, when: "self.stage == 'massnahme'" }],
        },
      ],
    });
    const next = run(doc, r);
    expect(
      stageOf(next).edges.some((e) => e.key === 'zuweisen' && e.from === 'massnahme' && e.to === 'erledigt'),
    ).toBe(true);
  });

  it('overrides the list of a task that has one, keeping its steps', () => {
    const doc = open();
    const r = connectOps(doc.effective(), {
      type: 'baum',
      property: 'stage',
      from: 'massnahme',
      to: 'erledigt',
      carrier: { task: 'kontrolle' },
    });
    expect(r.ok && r.ops[0]).toMatchObject({ kind: 'set', path: 'tasks.kontrolle.then' });
    const then = run(doc, r).effective().tasks?.kontrolle?.then;
    expect(then).toHaveLength(6);
    expect(then?.[5]).toEqual({ set: { stage: "'erledigt'" }, when: "self.stage == 'massnahme'" });
  });

  it('keeps the existing steps and needs no step condition when the task when already pins the source', () => {
    const doc = open();
    const r = connectOps(doc.effective(), {
      type: 'baum',
      property: 'stage',
      from: 'massnahme',
      to: 'erledigt',
      carrier: { task: 'massnahme_anlegen' },
    });
    expect(r.ok && r.ops[0]).toMatchObject({
      path: 'tasks.massnahme_anlegen.then',
      value: [{ set: { baum: 'self' } }, { set: { stage: "'erledigt'" } }],
    });
  });

  it('from "any state" adds an unconditional step', () => {
    const r = connectOps(open().effective(), {
      type: 'baum',
      property: 'stage',
      to: 'geprueft',
      carrier: { task: 'zuweisen' },
    });
    expect(r.ok && r.ops[0]).toMatchObject({ value: [{ set: { stage: "'geprueft'" } }] });
  });

  it('with a new task adds the task (label, on, when, then) and the arrow appears', () => {
    const doc = open();
    const r = connectOps(doc.effective(), {
      type: 'baum',
      property: 'stage',
      from: 'erfasst',
      to: 'geprueft',
      carrier: { newTask: { name: 'Schnell prüfen', lang: 'de' } },
    });
    expect(r).toEqual({
      ok: true,
      ops: [
        {
          kind: 'add',
          path: 'tasks.schnell_pruefen',
          value: {
            label: { de: 'Schnell prüfen' },
            on: 'baum',
            when: "self.stage == 'erfasst'",
            then: [{ set: { stage: "'geprueft'" } }],
          },
        },
      ],
    });
    const next = run(doc, r);
    expect(next.problems().length).toBe(doc.problems().length);
    expect(
      stageOf(next).edges.some(
        (e) => e.key === 'schnell_pruefen' && e.from === 'erfasst' && e.to === 'geprueft',
      ),
    ).toBe(true);
  });

  it('a step with `of` (it writes other features) is not an existing arrow of the subject', () => {
    const file = open().effective();
    const task = must(file.tasks?.['kontrolle']);
    const withOf = {
      ...file,
      tasks: {
        ...file.tasks,
        kontrolle: { ...task, then: [{ set: { stage: "'erledigt'" }, of: 'self.massnahmen' }] },
      },
    };
    const r = connectOps(withOf, {
      type: 'baum',
      property: 'stage',
      to: 'erledigt',
      carrier: { task: 'kontrolle' },
    });
    expect(r.ok).toBe(true);
  });

  it('refuses an arrow that exists, a source the task when contradicts, and an unknown task', () => {
    const file = open().effective();
    const base = { type: 'baum', property: 'stage' } as const;
    expect(connectOps(file, { ...base, to: 'geprueft', carrier: { task: 'kontrolle' } })).toEqual({
      ok: false,
      reason: 'exists',
    });
    expect(
      connectOps(file, { ...base, from: 'erfasst', to: 'erledigt', carrier: { task: 'massnahme_anlegen' } }),
    ).toEqual({
      ok: false,
      reason: 'task_pinned',
    });
    expect(connectOps(file, { ...base, to: 'erledigt', carrier: { task: 'gibt_es_nicht' } })).toEqual({
      ok: false,
      reason: 'unknown_task',
    });
  });

  it('every accepted connect leaves the file valid with no new problems (all golden select edges)', () => {
    const doc = open();
    const process = stageOf(doc);
    for (const from of [undefined, ...process.nodes.map((n) => n.option)]) {
      for (const to of process.nodes.map((n) => n.option)) {
        const r = connectOps(doc.effective(), {
          type: 'baum',
          property: 'stage',
          ...(from !== undefined ? { from } : {}),
          to,
          carrier: { newTask: { name: 'X', lang: 'en' } },
        });
        const next = run(doc, r);
        expect(next.problems().length).toBe(doc.problems().length);
        expect(stageOf(next).edges.length).toBeGreaterThan(process.edges.length);
      }
    }
  });
});

describe('editing and removing an arrow', () => {
  it('retargets a step and removes it, and the derived graph follows', () => {
    const doc = open();
    const edge = must(stageOf(doc).edges.find((e) => e.key === 'kontrolle' && e.to === 'geprueft'));
    const moved = run(doc, retargetOps(doc.effective(), edge, 'stage', 'erledigt'));
    expect(stageOf(moved).edges.some((e) => e.key === 'kontrolle' && e.to === 'erledigt')).toBe(true);
    expect(stageOf(moved).edges.some((e) => e.key === 'kontrolle' && e.to === 'geprueft')).toBe(false);

    const gone = run(doc, removeOps(doc.effective(), edge, 'stage'));
    expect(
      stageOf(gone)
        .edges.filter((e) => e.key === 'kontrolle')
        .map((e) => e.to),
    ).toEqual(['massnahme']);
    expect(gone.effective().tasks?.kontrolle?.then).toHaveLength(4);
  });

  it('a rule arrow is not edited here', () => {
    const doc = goldenDoc('maengelmelder', '1.0.0');
    const rule = must(
      deriveProcesses(doc.effective(), 'meldung')
        .flatMap((p) => p.edges)
        .find((e) => e.origin === 'rule'),
    );
    expect(removeOps(doc.effective(), rule, 'prioritaet')).toEqual({ ok: false, reason: 'unknown_task' });
  });
});

describe('newTaskKey', () => {
  it('makes a valid unique key', () => {
    const file = open().effective();
    expect(newTaskKey(file, 'Zuweisen')).toBe('zuweisen_2');
    expect(newTaskKey(file, '3. Prüfung!')).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(newTaskKey(file, '???')).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
