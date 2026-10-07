import { describe, expect, it } from 'vitest';
import { goldenDoc, templates } from '../../lenses/process/fixtures';
import { arrange, cardHeight, CARD } from './arrange';
import { buildCanvas, CANVAS_ORIGINS, nodeId, STAGE_KINDS, TOOL_KINDS } from './model';
import { stageOps } from '../stage/ops';
import { renameTaskOp } from './rename';

const baum = () => buildCanvas(goldenDoc('baumkataster', '2.0.0'), 'baum', 'de');

describe('canvas model of the baumkataster template', () => {
  it('has a card per stage, start and end marked', () => {
    const m = baum();
    expect(m.hasProcess).toBe(true);
    expect(m.stages.map((s) => [s.key, s.kind])).toEqual([
      ['erfasst', STAGE_KINDS.start],
      ['geprueft', STAGE_KINDS.step],
      ['massnahme', STAGE_KINDS.step],
      ['erledigt', STAGE_KINDS.end],
    ]);
    expect(m.stages.map((s) => s.label)).toEqual(['Erfasst', 'Geprüft', 'Maßnahme', 'Erledigt']);
  });

  it('puts task buttons on their stage and the stage-less ones in the global container', () => {
    const m = baum();
    expect(m.stages.find((s) => s.key === 'massnahme')?.tasks.map((t) => t.key)).toEqual([
      'massnahme_anlegen',
    ]);
    const global = m.global.map((t) => t.key);
    expect(global).toEqual(expect.arrayContaining(['kontrolle', 'befund_ergaenzen', 'verschieben']));
    // an entry task is a marker, never a button; a task of another type is not drawn
    expect(global).not.toContain('erfassen');
    expect(global).not.toContain('flaeche_bearbeiten');
  });

  it('shows one tool icon per step, in the order the task runs them (WP-435: icon i is step i)', () => {
    const m = baum();
    const byKey = new Map(m.global.map((t) => [t.key, t]));
    expect(byKey.get('kontrolle')?.tools).toEqual([TOOL_KINDS.form]);
    expect(byKey.get('baum_bearbeiten')?.tools).toEqual([TOOL_KINDS.edit, TOOL_KINDS.location]);
  });

  it('draws one arrow per then-step that sets the stage, from the task button to the stage', () => {
    const m = baum();
    const task = m.arrows.filter((a) => a.origin === CANVAS_ORIGINS.task);
    expect(task.map((a) => [a.handle, a.target]).sort()).toEqual([
      ['kontrolle', 'stage:geprueft'],
      ['kontrolle', 'stage:massnahme'],
    ]);
    expect(task.find((a) => a.target === 'stage:geprueft')?.otherwise).toBe(true);
    expect(m.global.find((t) => t.key === 'kontrolle')?.transitions).toBe(true);
  });

  it('has an entry marker leading to the start stage, and the rule nodes', () => {
    const m = baum();
    expect(m.entries).toEqual([{ key: 'erfassen', label: 'Baum erfassen' }]);
    const entry = m.arrows.find((a) => a.origin === CANVAS_ORIGINS.entry);
    expect(entry).toMatchObject({ source: nodeId.entry('erfassen'), target: nodeId.stage('erfasst') });
    expect(m.rules.map((r) => r.key)).toEqual([
      'massnahme_anlegen.massnahme_bei_schaden',
      'system_faellig.kontrolle_wird_faellig',
    ]);
    expect(m.rules[0]?.trigger.kind).toBe('after');
  });
});

describe('a type without a process (v3 empty state)', () => {
  it('has no stages and no entry arrow, only what is offered on the type', () => {
    const m = buildCanvas(goldenDoc('baumkataster', '2.0.0'), 'flaeche', 'de');
    expect(m.hasProcess).toBe(false);
    expect(m.stages).toEqual([]);
    expect(m.arrows).toEqual([]);
    expect(m.global.map((t) => t.key)).toContain('flaeche_bearbeiten');
  });
});

describe.each(templates)('%s %s: the model is consistent', (key, version) => {
  const doc = goldenDoc(key, version);
  const types = Object.keys(doc.effective().types ?? {});
  it.each(types)('type %s', (type) => {
    const m = buildCanvas(doc, type, 'en');
    const ids = new Set<string>([
      nodeId.global,
      ...m.stages.map((s) => nodeId.stage(s.key)),
      ...m.rules.map((r) => nodeId.rule(r.key)),
      ...m.entries.map((e) => nodeId.entry(e.key)),
    ]);
    expect(new Set(m.stages.map((s) => s.key)).size).toBe(m.stages.length);
    for (const a of m.arrows) {
      expect(ids.has(a.source)).toBe(true);
      expect(ids.has(a.target)).toBe(true);
      expect(a.slot).toBeLessThan(a.slots);
    }
    // an arrow's exit dot is a button, a rule or an entry of the node it leaves
    for (const a of m.arrows.filter((x) => x.origin === CANVAS_ORIGINS.task)) {
      const buttons =
        a.source === nodeId.global
          ? m.global
          : (m.stages.find((s) => nodeId.stage(s.key) === a.source)?.tasks ?? []);
      expect(buttons.map((t) => t.key)).toContain(a.handle);
    }
    const at = arrange(m);
    for (const id of ids) expect(at.has(id)).toBe(true);
    // no two stage cards overlap
    const cards = m.stages.map((s) => ({
      at: at.get(nodeId.stage(s.key)),
      h: cardHeight(s.tasks.length, s.tasks.filter((t) => t.child !== undefined).length),
    }));
    for (const [i, a] of cards.entries()) {
      for (const b of cards.slice(i + 1)) {
        if (a.at === undefined || b.at === undefined) continue;
        const apart =
          Math.abs(a.at.x - b.at.x) >= CARD.width || a.at.y + a.h <= b.at.y || b.at.y + b.h <= a.at.y;
        expect(apart).toBe(true);
      }
    }
  });
});

describe('rename ops', () => {
  it('a stage renames its option label in the builder language and keeps the key and other languages', () => {
    const doc = goldenDoc('maengelmelder', '1.0.0');
    const file = doc.effective();
    const type = Object.keys(file.types ?? {}).find((t) => file.types?.[t]?.process !== undefined) ?? '';
    const property = file.types?.[type]?.process?.property ?? '';
    const stage = Object.keys(file.types?.[type]?.properties[property]?.options ?? {})[0] ?? '';
    const op = stageOps.rename(file, type, stage, 'de', 'Neu benannt');
    expect(op).toMatchObject({ kind: 'set', path: `types.${type}.properties.${property}.options.${stage}` });
    expect((op as { value: Record<string, string> }).value['de']).toBe('Neu benannt');
  });

  it('a type without a process has nothing to rename', () => {
    const file = goldenDoc('baumkataster', '2.0.0').effective();
    expect(stageOps.rename(file, 'flaeche', 'x', 'de', 'Neu')).toBeUndefined();
  });

  it('a task renames its label and keeps the other languages', () => {
    const file = goldenDoc('baumkataster', '2.0.0').effective();
    const op = renameTaskOp(file, 'kontrolle', 'de', 'Prüfen');
    expect(op).toEqual({
      kind: 'set',
      path: 'tasks.kontrolle.label',
      value: { de: 'Prüfen', en: 'Perform inspection' },
    });
  });

  it('a button with a sub-process link makes its card taller, so the next card does not cover its "Button hinzufügen"', () => {
    expect(cardHeight(2, 1)).toBe(cardHeight(2) + CARD.link);
    expect(cardHeight(2, -1)).toBe(cardHeight(2));
  });
});
