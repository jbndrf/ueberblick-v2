import { describe, expect, it } from 'vitest';
import { deriveProcesses, literalOption, pinnedOptions } from './graph';
import { goldenDoc, must, templates } from './fixtures';

const baum = () => goldenDoc('baumkataster', '2.0.0').effective();

describe('pinnedOptions / literalOption', () => {
  it('reads == and in among && operands, either side', () => {
    expect(pinnedOptions("x && self.stage == 'a'", 'stage')).toEqual(['a']);
    expect(pinnedOptions("'a' == self.stage", 'stage')).toEqual(['a']);
    expect(pinnedOptions("self.stage in ['a', 'b']", 'stage')).toEqual(['a', 'b']);
  });
  it('does not pin on !=, ||, another property or a broken expression', () => {
    expect(pinnedOptions("self.stage != 'a'", 'stage')).toBeUndefined();
    expect(pinnedOptions("self.stage == 'a' || true", 'stage')).toBeUndefined();
    expect(pinnedOptions("self.other == 'a'", 'stage')).toBeUndefined();
    expect(pinnedOptions('((', 'stage')).toBeUndefined();
  });
  it('a quoted option is a literal, anything else is computed', () => {
    expect(literalOption("'massnahme'")).toBe('massnahme');
    expect(literalOption('form.x')).toBeUndefined();
    expect(literalOption(true)).toBeUndefined();
  });
});

describe('deriveProcesses on the golden templates', () => {
  it('gives the declared process only (not every select property), options as nodes', () => {
    const ps = deriveProcesses(baum(), 'baum');
    expect(ps.map((p) => p.property)).toEqual(['stage']);
    expect(ps[0]?.nodes.map((n) => n.option)).toEqual(['erfasst', 'geprueft', 'massnahme', 'erledigt']);
    expect(ps[0]?.nodes.find((n) => n.isStart)?.option).toBe('erfasst');
  });

  it('a task whose then sets an option is an arrow from anywhere (step order kept)', () => {
    const stage = must(deriveProcesses(baum(), 'baum')[0]);
    const arrows = stage.edges.filter((e) => e.origin === 'task');
    expect(arrows.map((e) => [e.key, e.step, e.from, e.to])).toEqual([
      ['kontrolle', 1, undefined, 'massnahme'],
      ['kontrolle', 2, undefined, 'geprueft'],
    ]);
    expect(arrows[0]?.when).toBe("form.vitalitaet >= 'v3'");
  });

  it('marks an otherwise step, and only that step', () => {
    const arrows = must(deriveProcesses(baum(), 'baum')[0]).edges.filter((e) => e.key === 'kontrolle');
    expect(arrows.map((e) => [e.step, e.otherwise])).toEqual([
      [1, undefined],
      [2, true],
    ]);
  });

  it('does not call an arrow "from any state" when its when names no state or cannot be read', () => {
    const doc = goldenDoc('baumkataster', '2.0.0');
    const stage = (d: typeof doc) => must(deriveProcesses(d.effective(), 'baum')[0]);
    // kontrolle has a role-only when: a condition exists but names no state
    expect(stage(doc).edges.every((e) => e.unfixed === 'unpinned')).toBe(true);
    const broken = doc.apply({ kind: 'set', path: 'tasks.kontrolle.when', value: 'self.stage ==' }).doc;
    expect(stage(broken).edges.map((e) => e.unfixed)).toEqual(['unparsed', 'unparsed']);
    // no when at all: truly from any state
    const bare = doc.apply({
      kind: 'add',
      path: 'tasks.frei',
      value: { label: { en: 'Free' }, on: 'baum', then: [{ set: { stage: "'erledigt'" } }] },
    }).doc;
    const free = stage(bare).edges.find((e) => e.key === 'frei');
    expect(free?.from).toBeUndefined();
    expect(free?.unfixed).toBeUndefined();
    // a pinned source is never unfixed
    const pinned = must(deriveProcesses(goldenDoc('maengelmelder', '1.0.0').effective(), 'meldung')[0]);
    expect(pinned.edges.filter((e) => e.from !== undefined).every((e) => e.unfixed === undefined)).toBe(true);
  });

  it('a task that does not change the property sits on the node its when pins', () => {
    const stage = must(deriveProcesses(baum(), 'baum')[0]);
    expect(stage.nodes.find((n) => n.option === 'massnahme')?.tasks).toEqual(['massnahme_anlegen']);
    expect(stage.nodes.flatMap((n) => n.tasks)).toEqual(['massnahme_anlegen']);
  });

  it('a type without a declared process has none; an unknown type neither', () => {
    expect(deriveProcesses(baum(), 'baumart')).toEqual([]);
    expect(deriveProcesses(baum(), 'flaeche')).toEqual([]);
    expect(deriveProcesses(baum(), 'nope')).toEqual([]);
  });

  it('draws only the declared process: other selects have none, rules show where their task sets the stage', () => {
    const m = goldenDoc('maengelmelder', '1.0.0').effective();
    const ps = deriveProcesses(m, 'meldung');
    expect(ps.map((p) => p.property)).toEqual(['status']);
    const status = must(ps[0]);
    expect(status.edges.some((e) => e.from === 'offen' && e.to === 'bewertet')).toBe(true);
    expect(status.edges.some((e) => e.origin === 'rule' && e.to === 'hoch')).toBe(false);
  });

  it('every arrow of every golden template ends on an existing option and starts on one or anywhere', () => {
    for (const [key, version] of templates) {
      const file = goldenDoc(key, version).effective();
      for (const type of Object.keys(file.types ?? {})) {
        for (const p of deriveProcesses(file, type)) {
          const options = new Set(p.nodes.map((n) => n.option));
          for (const e of p.edges) {
            expect(options.has(e.to)).toBe(true);
            expect(e.from === undefined || options.has(e.from)).toBe(true);
          }
          expect(new Set(p.edges.map((e) => e.id)).size).toBe(p.edges.length);
        }
      }
    }
  });
});
