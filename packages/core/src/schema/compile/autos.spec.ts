// C-004: the compiled table of automatic actions, `tasks.<task>.auto.<name>`.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { TemplateFileSchema, type TemplateFile } from '../file';
import { AUTO_TIMING_KINDS } from '../../registry';
import { autoId, autoPath, listAutos, splitAutoId, timingOf } from './autos';
import { compile as compileWith } from './index';
import { goldenAssets } from '../../testing/golden';

const compile = (f: TemplateFile) => compileWith(f, { assets: goldenAssets });
const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = (): TemplateFile => TemplateFileSchema.parse(parse(Object.values(raw)[0] as string));

describe('table of automatic actions', () => {
  it('lists every entry with its task, name and timing, in file order', () => {
    const f = base();
    const list = listAutos(f);
    expect(list.map((a) => [a.id, a.task, a.name, a.kind])).toEqual([
      ['melden.spielplatz_melden', 'melden', 'spielplatz_melden', 'after'],
    ]);
  });

  it('resolves each timing kind, and `edge` when the entry has no timing key', () => {
    expect(timingOf({ after: 'k' })).toBe('after');
    expect(timingOf({ change: 'baum.stage' })).toBe('change');
    expect(timingOf({ elapsed: { from: 'self.a' } })).toBe('elapsed');
    expect(timingOf({ schedule: '0 3 * * *', idle: 'days(1)' })).toBe('schedule');
    expect(timingOf({ when: 'true' })).toBe('edge');
    for (const k of AUTO_TIMING_KINDS.keys) expect(typeof k).toBe('string');
  });

  it('indexes by trigger: after, change, edge, elapsed, schedule', () => {
    const f = base();
    const t = f.tasks as NonNullable<TemplateFile['tasks']>;
    const kontrolle = t['kontrolle'] as NonNullable<(typeof t)[string]>;
    kontrolle.auto = {
      geaendert: { change: 'baum.stage' },
      bedingt: { when: "self.stage == 'erledigt'" },
      faellig: { elapsed: { from: 'self.faellig_am' } },
      nachts: { schedule: '0 3 * * *', idle: 'days(1)' },
    };
    const r = compile(f);
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    const idx = r.config.autosByTrigger;
    expect(idx.get('task.kontrolle')).toEqual(['melden.spielplatz_melden']);
    expect(idx.get('baum.stage')).toEqual(['kontrolle.geaendert']);
    expect(idx.get('when')).toEqual(['kontrolle.bedingt']);
    expect(idx.get('elapsed')).toEqual(['kontrolle.faellig']);
    expect(idx.get('schedule')).toEqual(['kontrolle.nachts']);
    expect(r.config.autos.size).toBe(5);
  });

  it('problem paths point into the file: tasks.<t>.auto.<name>.<field>', () => {
    const [a] = listAutos(base());
    expect(a && autoPath(a, 'when')).toBe('tasks.melden.auto.spielplatz_melden.when');
    expect(a && autoPath(a)).toBe('tasks.melden.auto.spielplatz_melden');
  });

  it('property: the id of (task, name) splits back into the same pair', () => {
    const key = fc.stringMatching(/^[a-z][a-z0-9_]{0,8}$/);
    fc.assert(
      fc.property(key, key, (task, name) => {
        expect(splitAutoId(autoId(task, name))).toEqual({ task, name });
      }),
    );
  });
});
