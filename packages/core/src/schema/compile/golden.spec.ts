// Every golden template and overlay compiles (overlays via template.merge) with zero skips (WP-013.1).
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { OverlayFileSchema, TemplateFileSchema, type OverlayFile, type TemplateFile } from '../file';
import { merge } from '../../template';
import { compile as compileWith, hydrate, problemsFromMergeIssues, serialize } from './index';
import type { Problem } from './contract';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

const read = (g: Record<string, unknown>): [string, unknown][] =>
  Object.entries(g).map(([f, s]) => [f, parse(s as string)]);
const glob = <T>(g: Record<string, unknown>, schema: { parse(v: unknown): T }) =>
  read(g).map(([f, v]) => [f, schema.parse(v)] as const);

const templates = glob<TemplateFile>(
  import.meta.glob('/fixtures/golden/templates/*/*.yaml', { query: '?raw', import: 'default', eager: true }),
  TemplateFileSchema,
);
const candidates = glob<TemplateFile>(
  import.meta.glob('/fixtures/golden/candidates/*/*.yaml', { query: '?raw', import: 'default', eager: true }),
  TemplateFileSchema,
);
const projects = glob<OverlayFile>(
  import.meta.glob('/fixtures/golden/projects/*.yaml', { query: '?raw', import: 'default', eager: true }),
  OverlayFileSchema,
);

/** The newest template of the overlay's `extends: <name>@<major>`. */
function baseOf(o: OverlayFile): TemplateFile {
  const [name, major] = o.extends.split('@');
  const found = templates
    .filter(([f, t]) => f.includes(`/${name}/`) && t.template.version.startsWith(`${major}.`))
    .map(([, t]) => t)
    .sort((a, b) => a.template.version.localeCompare(b.template.version, 'en', { numeric: true }));
  const last = found[found.length - 1];
  if (!last) throw new Error(`no template for ${o.extends}`);
  return last;
}

const NEGATIVE = 'musterstadt-locked-violation';
const codes = (ps: readonly Problem[]): string[] => ps.map((p) => p.code);

describe('A-009: no `actor.role` in the corpus or the format docs', () => {
  const sources = {
    ...import.meta.glob('/fixtures/golden/**/*.yaml', { query: '?raw', import: 'default', eager: true }),
    ...import.meta.glob('/docs/0[56]-*.md', { query: '?raw', import: 'default', eager: true }),
  };
  it('finds files to scan', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
  });
  for (const [file, text] of Object.entries(sources)) {
    it(`${file} has no \`actor.role\` (singular)`, () => {
      const hits = (text as string).split('\n').filter((l) => /actor\.role\b(?!s)/.test(l));
      expect(hits).toEqual([]);
    });
  }
});

describe('compile: the golden corpus, no skips', () => {
  it('finds the corpus', () => {
    expect(templates.length).toBeGreaterThanOrEqual(5);
    expect(projects.length).toBeGreaterThanOrEqual(5);
  });

  for (const [file, t] of [...templates, ...candidates]) {
    it(`template ${file}`, () => {
      const r = compile(t);
      expect(r.ok ? [] : r.problems, file).toEqual([]);
      expect(r.ok ? r.warnings : [], file).toEqual([]);
    });
  }

  for (const [file, o] of projects) {
    if (file.includes(NEGATIVE)) continue;
    it(`overlay ${file}`, () => {
      const m = merge(baseOf(o), o);
      expect(m.issues, file).toEqual([]);
      const r = compile(TemplateFileSchema.parse(m.file));
      expect(r.ok ? [] : r.problems, file).toEqual([]);
      expect(r.ok ? r.warnings : [], file).toEqual([]);
    });
  }

  it('the negative overlay produces its expected codes', () => {
    const entry = projects.find(([f]) => f.includes(NEGATIVE));
    if (!entry) throw new Error('negative fixture missing');
    const m = merge(baseOf(entry[1]), entry[1]);
    const found = codes(problemsFromMergeIssues(m.issues));
    expect(found).toEqual(expect.arrayContaining(['lock_violation', 'unknown_path', 'hidden_referenced']));
  });

  it('stored types round-trip exactly for every compiled expression (hydrate restores typed)', () => {
    let n = 0;
    for (const [, t] of [...templates, ...candidates]) {
      const r = compile(t);
      if (!r.ok) throw new Error('template must compile');
      const data = serialize(r.config);
      const h = hydrate(JSON.parse(JSON.stringify(data)));
      for (const [path, e] of r.config.expressions) {
        expect(h.expressions.get(path)?.typed.type).toEqual(e.typed.type);
        n++;
      }
      // Same types in the same nodes: serializing the hydrated config reproduces the stored list.
      expect(serialize(h)).toEqual(data);
    }
    expect(n).toBeGreaterThan(50);
  });
});
