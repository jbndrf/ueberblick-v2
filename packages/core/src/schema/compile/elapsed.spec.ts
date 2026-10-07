// WP-556: compile checks and stores the expressions of an automatic `elapsed` (from, after, offset).
// The negative cases live in __fixtures__/cases.yaml (compile.spec.ts runs them); the golden corpus is in golden.spec.ts.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile as compileWith } from './index';
import { listAutos } from './autos';
import { TemplateFileSchema, type TemplateFile } from '../file';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const golden = import.meta.glob('/fixtures/golden/templates/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** The base file with one more automatic action `faellig` on `task`. */
const withAuto = (task: string, entry: unknown): TemplateFile => {
  const f = parse(Object.values(raw)[0] as string) as {
    tasks: Record<string, { auto?: Record<string, unknown> }>;
  };
  const t = f.tasks[task] as { auto?: Record<string, unknown> };
  t.auto = { ...t.auto, faellig: entry };
  return TemplateFileSchema.parse(f);
};

const AT = 'tasks.kontrolle.auto.faellig';

describe('compile: automatic elapsed', () => {
  it('stores from, after and offset by key path, typed', () => {
    const r = compile(
      withAuto('kontrolle', {
        elapsed: {
          from: 'self.faellig_am',
          after: 'days(1)',
          offset: '-days(inputs.kontrollintervall_monate)',
        },
        when: "self.stage != 'erledigt'",
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    const e = r.config.expressions;
    expect(e.get(`${AT}.elapsed.from`)?.typed.type.kind).toBe('timestamp');
    expect(e.get(`${AT}.elapsed.after`)?.typed.type.kind).toBe('duration');
    expect(e.get(`${AT}.elapsed.offset`)?.typed.type.kind).toBe('duration');
    expect(e.get(`${AT}.when`)?.typed.type.kind).toBe('bool');
  });

  it('from alone is enough', () => {
    const r = compile(withAuto('kontrolle', { elapsed: { from: 'self.faellig_am' } }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.expressions.has(`${AT}.elapsed.from`)).toBe(true);
      expect(r.config.expressions.has(`${AT}.elapsed.offset`)).toBe(false);
    }
  });

  it('a schedule on a task without a subject has no expressions to store', () => {
    const r = compile(withAuto('melden', { schedule: '0 6 * * *' }));
    expect(r.ok).toBe(true);
    if (r.ok)
      expect([...r.config.expressions.keys()].some((k) => k.startsWith('tasks.melden.auto.faellig'))).toBe(
        false,
      );
  });

  it('every elapsed timing of the golden corpus is stored', () => {
    let seen = 0;
    for (const [file, src] of Object.entries(golden)) {
      const t = TemplateFileSchema.parse(parse(src as string));
      const r = compile(t);
      if (!r.ok) continue; // golden.spec.ts owns "compiles"; here only the stored keys
      for (const a of listAutos(t)) {
        if (a.kind !== 'elapsed') continue;
        seen++;
        const from = r.config.expressions.get(`tasks.${a.task}.auto.${a.name}.elapsed.from`);
        expect(from?.typed.type.kind, `${file} ${a.id}`).toBe('timestamp');
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
