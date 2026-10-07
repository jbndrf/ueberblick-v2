// Every task form in the golden corpus evaluates without a typed error (FormConfigError), empty and with
// the input of every golden scenario run that names the task.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { merge } from '../template';
import { OverlayFileSchema, TemplateFileSchema, type OverlayFile, type TemplateFile } from '../schema/file';
import { compile } from '../schema/compile';
import type { CompiledConfig } from '../schema/compile/contract';
import type { Json, Key } from '../model';
import { formApi } from './index';
import type { FormValues } from './contract';
import { ctx } from './__fixtures__';
import { goldenAssets } from '../testing/golden';

const NEGATIVE = 'locked-violation';
const raw = (g: Record<string, unknown>): [string, unknown][] =>
  Object.entries(g).map(([f, s]) => [f, parse(s as string)]);
const templates = raw(
  import.meta.glob('/fixtures/golden/templates/*/*.yaml', { query: '?raw', import: 'default', eager: true }),
).map(([f, v]) => [f, TemplateFileSchema.parse(v)] as const);
const projects = raw(
  import.meta.glob('/fixtures/golden/projects/*.yaml', { query: '?raw', import: 'default', eager: true }),
).map(([f, v]) => [f, OverlayFileSchema.parse(v)] as const);
const scenarios = raw(
  import.meta.glob('/fixtures/golden/scenarios/**/*.yaml', { query: '?raw', import: 'default', eager: true }),
) as [
  string,
  {
    given?: { project?: string };
    when?: { id?: string; kind?: string; task?: string; input?: unknown }[];
    then?: { steps?: Record<string, { outcome?: string }> };
  },
][];

const baseOf = (o: OverlayFile): TemplateFile => {
  const [name, major] = o.extends.split('@');
  const found = templates
    .filter(([f, t]) => f.includes(`/${name}/`) && t.template.version.startsWith(`${major}.`))
    .map(([, t]) => t)
    .sort((a, b) => a.template.version.localeCompare(b.template.version, 'en', { numeric: true }));
  const last = found[found.length - 1];
  if (!last) throw new Error(`no template for ${o.extends}`);
  return last;
};

function build(file: TemplateFile): CompiledConfig {
  const r = compile(file, { assets: goldenAssets });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
}

const configs: [string, CompiledConfig][] = [
  ...templates.map(([f, t]) => [f, build(t)] as [string, CompiledConfig]),
  ...projects
    .filter(([f]) => !f.includes(NEGATIVE))
    .map(
      ([f, o]) => [f, build(TemplateFileSchema.parse(merge(baseOf(o), o).file))] as [string, CompiledConfig],
    ),
];

describe('golden corpus: every task form evaluates', () => {
  it('finds forms', () => {
    const n = configs.flatMap(([, c]) => Object.values(c.file.tasks ?? {})).filter((t) => t.form).length;
    expect(n).toBeGreaterThan(10);
  });

  for (const [file, config] of configs) {
    it(`${file}: empty values and initial`, () => {
      for (const [task, def] of Object.entries(config.file.tasks ?? {})) {
        if (!def.form) continue;
        const c = ctx(config);
        const init = formApi.initial(task as Key, config, c);
        const e = formApi.evaluate(task as Key, config, init, c);
        expect(e.fields.map((f) => f.key)).toEqual(Object.keys(def.form));
        formApi.submitValues(e);
        const target = def.on;
        const type = Array.isArray(target) ? (target[0] as Key) : undefined;
        const evalWith = (v: FormValues) => formApi.evaluate(task as Key, config, v, c, type);
        const base = evalWith(init);
        // Changing one field leaves every field outside dependents() with an identical state.
        for (const changed of Object.keys(def.form)) {
          const inside = new Set(formApi.dependents(task as Key, config, changed as Key));
          expect(inside.has(changed as Key)).toBe(true);
          for (const next of [undefined, null, '', 'v3', 42, true] as (Json | undefined)[]) {
            const values: Record<string, Json> = { ...init };
            if (next === undefined) Reflect.deleteProperty(values, changed);
            else values[changed] = next;
            const after = evalWith(values);
            base.fields.forEach((was, i) => {
              if (!inside.has(was.key))
                expect(after.fields[i], `${file} ${task}.${was.key} after ${changed}`).toEqual(was);
            });
          }
        }
      }
    });
  }

  it("scenario runs' inputs", () => {
    let runs = 0;
    for (const [, s] of scenarios) {
      const project = s.given?.project;
      if (!project) continue;
      if (project.includes(NEGATIVE)) continue; // the negative overlay does not compile, by design
      const entry = configs.find(([f]) => f.endsWith(project));
      if (!entry) throw new Error(`scenario project ${project} is not in the compiled corpus`);
      for (const step of s.when ?? []) {
        if (step.kind !== 'run' || !step.task) continue;
        const def = entry[1].file.tasks?.[step.task];
        if (!def) {
          // only a run the scenario expects to be refused may name a task the project does not have
          expect(s.then?.steps?.[step.id ?? '']?.outcome, `${step.task} of ${project}`).toBe('refused');
          continue;
        }
        if (!def.form) continue;
        const input = (step.input ?? {}) as FormValues;
        const c = ctx(entry[1]);
        const e = formApi.evaluate(step.task as Key, entry[1], input as { [k: string]: Json }, c);
        formApi.submitValues(e);
        runs++;
      }
    }
    expect(runs).toBeGreaterThan(5);
  });
});
