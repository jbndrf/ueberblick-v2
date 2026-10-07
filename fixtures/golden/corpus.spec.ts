// Structural gate for the golden corpus (WP-011). It does NOT execute scenarios (WP-050 does).
// It proves the corpus is well-formed, closed over its vocabulary, and covers every capability.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { isPlanted } from '../../scripts/testing/plant.mjs';
import { z } from 'zod';
import { parseProjectFile } from '../../packages/core/src/schema';
import { TEMPLATE_BREAKING_KINDS } from '../../packages/core/src/registry/template';
import { PROBLEM_CODES } from '../../packages/core/src/registry/compile';
import { parse as parseExpr } from '../../packages/core/src/expr/parse';

const root = dirname(fileURLToPath(import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    if (isPlanted(e)) return [];
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const load = (p: string): unknown => parse(readFileSync(p, 'utf8'));
const yamlFiles = (sub: string): string[] => walk(join(root, sub)).filter((p) => p.endsWith('.yaml'));

const vocab = z
  .object({
    foundations: z.array(z.string()),
    step_kinds: z.record(z.string(), z.string()),
    refusal_codes: z.record(z.string(), z.string()),
    problem_codes: z.record(z.string(), z.string()),
    capabilities: z.array(z.string()),
  })
  .parse(load(join(root, 'vocabulary.yaml')));

const Json = z.unknown();
const Step = z
  .object({
    id: z.string().regex(/^s\d+$/),
    kind: z.string().refine((k) => k in vocab.step_kinds, 'unknown step kind'),
  })
  .passthrough();
const Scenario = z.object({
  scenario: z.string(),
  title: z.string(),
  foundations: z.array(z.string()).min(1),
  capabilities: z.array(z.string()).min(1),
  given: z
    .object({
      project: z.string().optional(),
      template: z.string().optional(),
      now: z.string().optional(),
      platform: Json.optional(),
      participants: Json.optional(),
      features: Json.optional(),
      config_version: z.number().optional(),
    })
    .passthrough(),
  when: z.array(Step).min(1),
  then: z.object({ steps: z.record(z.string(), Json).optional() }).passthrough(),
});
type ScenarioT = z.infer<typeof Scenario>;

const scenarioFiles = yamlFiles('scenarios');
const scenarios = scenarioFiles.map((f) => ({ file: f, doc: Scenario.parse(load(f)) }));
const byName = (n: string): ScenarioT => {
  const s = scenarios.find((x) => x.doc.scenario === n);
  if (!s) throw new Error(`scenario ${n} missing`);
  return s.doc;
};
const walkValues = (v: unknown, fn: (k: string | null, v: unknown) => void, k: string | null = null): void => {
  fn(k, v);
  if (Array.isArray(v)) v.forEach((x) => walkValues(x, fn, null));
  else if (v && typeof v === 'object')
    Object.entries(v).forEach(([kk, x]) => walkValues(x, fn, kk));
};

describe('corpus layout', () => {
  it('has at least 3 templates from different domains and at least 25 scenarios', () => {
    const keys = new Set(yamlFiles('templates').map((f) => relative(join(root, 'templates'), f).split('/')[0]));
    expect(keys.size).toBeGreaterThanOrEqual(3);
    expect(scenarios.length).toBeGreaterThanOrEqual(25);
  });

  it('template files carry schema, template key and version matching their path', () => {
    for (const f of yamlFiles('templates')) {
      const d = z
        .object({ schema: z.string().regex(/^ueberblick\/\d+$/), template: z.object({ key: z.string(), version: z.string() }) })
        .passthrough()
        .parse(load(f));
      const [key, file] = relative(join(root, 'templates'), f).split('/');
      expect(d.template.key, f).toBe(key);
      expect(basename(file ?? '', '.yaml'), f).toBe(d.template.version);
    }
  });

  it('project files extend an existing template major', () => {
    for (const f of yamlFiles('projects')) {
      const d = z.object({ schema: z.string(), extends: z.string().regex(/^[a-z][a-z0-9_]*@\d+$/) }).passthrough().parse(load(f));
      const [key, major] = d.extends.split('@');
      const has = yamlFiles(`templates/${key}`).some((t) => basename(t).startsWith(`${major}.`));
      expect(has, `${f} extends ${d.extends}`).toBe(true);
    }
  });

  it('every template and project uses ID-keyed maps for entities, never lists', () => {
    for (const f of [...yamlFiles('templates'), ...yamlFiles('projects')]) {
      const d = load(f) as Record<string, unknown>;
      for (const k of ['types', 'tasks', 'rules', 'views', 'roles', 'tools'])
        if (k in d) expect(Array.isArray(d[k]), `${f}: ${k}`).toBe(false);
    }
  });

  it('is written from capabilities: no file mentions the v3 reference tree', () => {
    for (const f of walk(root).filter((p) => /\.(yaml|md)$/.test(p))) {
      const txt = readFileSync(f, 'utf8').replace(/reference\/\*?\*? ?\(?read-only/gi, '');
      if (basename(f) === 'README.md') continue;
      expect(/reference\/|pocketbase|pb_hooks/i.test(txt), f).toBe(false);
    }
  });

  it('ships the generator spec for the 60k benchmark dataset', () => {
    const b = z
      .object({ seed: z.number(), total_features: z.literal(60000), types: z.record(z.string(), z.object({ count: z.number() }).passthrough()) })
      .passthrough()
      .parse(load(join(root, 'bench-spec.yaml')));
    expect(Object.values(b.types).reduce((a, t) => a + t.count, 0)).toBe(b.total_features);
  });
});

describe('scenario well-formedness', () => {
  it('file name equals scenario name, step ids are unique, then.steps refer to steps', () => {
    for (const { file, doc } of scenarios) {
      expect(basename(file, '.yaml'), file).toBe(doc.scenario);
      const ids = doc.when.map((s) => s.id);
      expect(new Set(ids).size, file).toBe(ids.length);
      for (const k of Object.keys(doc.then.steps ?? {})) expect(ids, `${file} then.${k}`).toContain(k);
    }
  });

  it('the referenced project or template file exists', () => {
    for (const { file, doc } of scenarios) {
      const ref = doc.given.project ?? doc.given.template;
      expect(ref, file).toBeTruthy();
      expect(existsSync(join(root, ref ?? 'missing')), `${file} -> ${ref}`).toBe(true);
    }
  });

  it('every scenario lists foundations (F1-F13) and capabilities from the vocabulary', () => {
    for (const { file, doc } of scenarios) {
      for (const f of doc.foundations) expect(vocab.foundations, file).toContain(f);
      for (const c of doc.capabilities) expect(vocab.capabilities, `${file}: ${c}`).toContain(c);
    }
  });

  it('every problem code in the vocabulary exists in the core registry', () => {
    const registry: readonly string[] = PROBLEM_CODES.keys;
    expect(Object.keys(vocab.problem_codes).filter((c) => !registry.includes(c))).toEqual([]);
  });

  it('every `change:` kind used in a scenario exists in TEMPLATE_BREAKING_KINDS', () => {
    const registry: readonly string[] = TEMPLATE_BREAKING_KINDS.keys;
    const used: string[] = [];
    for (const { doc } of scenarios)
      walkValues(doc.then, (k, v) => {
        if (k === 'change' && typeof v === 'string') used.push(v);
      });
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((c) => !registry.includes(c))).toEqual([]);
  });

  it('no v3-era problem names are left anywhere in the corpus', () => {
    const stale = /locked_key|unknown_input|hidden_reference\b/;
    const hits = walk(root).filter((f) => /\.(ya?ml|md)$/.test(f) && stale.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => relative(root, f))).toEqual([]);
  });

  it('every refusal and problem code used is in the vocabulary', () => {
    for (const { file, doc } of scenarios)
      walkValues(doc.then, (k, v) => {
        if (k === 'refusal' && typeof v === 'string') expect(vocab.refusal_codes, file).toHaveProperty(v);
        if (k === 'problem' && typeof v === 'string') expect(vocab.problem_codes, file).toHaveProperty(v);
      });
  });

  it('expressions in the corpus have balanced brackets and quotes', () => {
    const files = [...yamlFiles('templates'), ...yamlFiles('projects'), ...scenarioFiles];
    const exprKeys = new Set(['when', 'relevant', 'required', 'constraint', 'calculate', 'derive', 'filter', 'visible_when', 'otherwise']);
    for (const f of files)
      walkValues(load(f), (k, v) => {
        if (!k || !exprKeys.has(k) || typeof v !== 'string') return;
        const stripped = v.replace(/'[^']*'/g, "''");
        expect((stripped.match(/'/g) ?? []).length % 2, `${f}: ${v}`).toBe(0);
        for (const [o, c] of [['(', ')'], ['[', ']'], ['{', '}']] as const)
          expect(stripped.split(o).length, `${f}: ${v}`).toBe(stripped.split(c).length);
      });
  });
});

describe('schema and parser gate (WP-010, WP-010.1, WP-020)', () => {
  const projectFiles = [...yamlFiles('templates'), ...yamlFiles('projects'), ...yamlFiles('candidates')];

  it('every template and overlay passes parseProjectFile, without exceptions', () => {
    const problems: string[] = [];
    for (const f of projectFiles) {
      const r = parseProjectFile(load(f));
      if (r.success) continue;
      for (const issue of r.error.issues) problems.push(`${relative(root, f)}: ${issue.path.join('.')}: ${issue.message}`);
    }
    expect(problems).toEqual([]);
  });

  it('no fixture carries a pending_schema list any more (the schema covers the corpus)', () => {
    for (const f of [...projectFiles, ...scenarioFiles, ...yamlFiles('seeds')])
      expect(readFileSync(f, 'utf8'), f).not.toContain('pending_schema');
  });

  // Keys whose string value is an expression; `then.set` and `with` values follow A-004 item 9 (a string is always one).
  const exprKeys = new Set(['when', 'relevant', 'required', 'constraint', 'calculate', 'derive', 'filter', 'visible_when', 'readonly', 'because']);
  const exprMaps = new Set(['set', 'with']);
  const parses = (v: string): string | null => {
    const r = parseExpr(v);
    return r.ok ? null : (r.errors[0]?.message ?? 'parse error');
  };

  it('every expression string in templates, overlays and scenarios parses (then.set and with values included)', () => {
    const problems: string[] = [];
    const scan = (v: unknown, path: string, key: string | null, parent: string | null, file: string): void => {
      if (typeof v === 'string') {
        const isExpr =
          key !== null &&
          (exprKeys.has(key) ||
            (parent !== null && exprMaps.has(parent) && !path.startsWith('then.')) ||
            (path.includes('.elapsed.') && ['from', 'after', 'offset'].includes(key)));
        if (isExpr) {
          const err = parses(v);
          if (err) problems.push(`${file}: ${path}: ${v} -> ${err}`);
        }
      } else if (Array.isArray(v)) v.forEach((x, i) => scan(x, `${path}.${i}`, key, parent, file));
      else if (v && typeof v === 'object')
        for (const [k, x] of Object.entries(v)) scan(x, path ? `${path}.${k}` : k, k, key, file);
    };
    for (const f of [...projectFiles, ...yamlFiles('seeds')]) scan(load(f), '', null, null, relative(root, f));
    // scenarios: only the config they embed (overrides, adds) carries expressions; `set`/`with` there are config too
    for (const f of scenarioFiles) scan(load(f), '', null, null, relative(root, f));
    expect(problems).toEqual([]);
  });

  it('a bare option key in a then.set value is not an expression the gate accepts as a literal', () => {
    // "'massnahme'" is the literal; a bare massnahme parses as an identifier, which compile() hints on (A-004 item 9).
    expect(parses("'massnahme'")).toBeNull();
    expect(parses("'massnahme")).not.toBeNull();
  });

  it('every then.set and with string in the corpus templates is an expression, never prose', () => {
    for (const f of projectFiles) {
      const doc = load(f) as { tasks?: Record<string, { then?: { set?: Record<string, unknown>; redact?: { of?: unknown } }[] }>; rules?: Record<string, { with?: Record<string, unknown> }> };
      const values = [
        ...Object.values(doc.tasks ?? {}).flatMap((t) => (t.then ?? []).flatMap((st) => [...Object.values(st.set ?? {}), st.redact?.of])),
        ...Object.values(doc.rules ?? {}).flatMap((r) => Object.values(r.with ?? {})),
      ];
      for (const v of values) if (typeof v === 'string') expect(parses(v), `${relative(root, f)}: ${v}`).toBeNull();
    }
  });
});

describe('references', () => {
  const aliasesOf = (doc: ScenarioT): Set<string> => {
    const out = new Set<string>();
    const given = doc.given as { include?: string[]; features?: Record<string, unknown> };
    for (const inc of given.include ?? []) {
      const seed = load(join(root, inc)) as { features?: Record<string, unknown> };
      Object.keys(seed.features ?? {}).forEach((k) => out.add(k));
    }
    Object.keys(given.features ?? {}).forEach((k) => out.add(k));
    walkValues(doc.when, (k, v) => {
      if ((k === 'creates' || k === 'alias') && typeof v === 'string') out.add(v.replace('$new:', ''));
    });
    walkValues(doc.then, (k, v) => {   // features created by rules are named where the rule run is expected
      if (k === 'rule_runs' && Array.isArray(v))
        for (const r of v as { feature?: string }[]) if (r.feature?.startsWith('$new:')) out.add(r.feature.slice(5));
    });
    return out;
  };

  it('every feature alias used in when and then is defined by a seed, given or a creating step', () => {
    for (const { file, doc } of scenarios) {
      const known = aliasesOf(doc);
      const used: string[] = [];
      walkValues(doc.when, (k, v) => {
        if (typeof v === 'string' && k === 'feature') used.push(v);
      });
      walkValues(doc.then, (k, v) => {
        if (typeof v === 'string' && (k === 'feature' || k === 'from' || k === 'to')) used.push(v);
      });
      const thenFeatures = (doc.then as { features?: Record<string, unknown> }).features ?? {};
      used.push(...Object.keys(thenFeatures));
      for (const u of used) {
        const a = u.replace('$new:', '');
        // to: park etc. may also name an alias, but never a free text; relations name other things than ids
        expect(known.has(a), `${file}: unknown feature alias ${u}`).toBe(true);
      }
    }
  });

  it('every included seed exists and every actor alias resolves to a participant or an actor object', () => {
    for (const { file, doc } of scenarios) {
      const given = doc.given as { include?: string[]; participants?: Record<string, unknown> };
      const people = new Set(Object.keys(given.participants ?? {}));
      for (const inc of given.include ?? []) {
        expect(existsSync(join(root, inc)), `${file}: ${inc}`).toBe(true);
        Object.keys(((load(join(root, inc)) as { participants?: Record<string, unknown> }).participants) ?? {}).forEach((p) => people.add(p));
      }
      walkValues(doc.when, (k, v) => {
        if (k === 'actor' && typeof v === 'string') expect(people.has(v), `${file}: actor ${v}`).toBe(true);
      });
    }
  });
});

describe('coverage gate', () => {
  it('every capability in the vocabulary is exercised by at least one scenario', () => {
    const used = new Set(scenarios.flatMap((s) => s.doc.capabilities));
    expect(vocab.capabilities.filter((c) => !used.has(c))).toEqual([]);
  });

  it('every foundation F1-F13 is exercised by at least one scenario', () => {
    const used = new Set(scenarios.flatMap((s) => s.doc.foundations));
    expect(vocab.foundations.filter((c) => !used.has(c))).toEqual([]);
  });

  it('every step kind is used at least once', () => {
    const used = new Set(scenarios.flatMap((s) => s.doc.when.map((w) => w.kind)));
    expect(Object.keys(vocab.step_kinds).filter((k) => !used.has(k))).toEqual([]);
  });

  it('covers refusals: at least 10 distinct refusal codes and 3 problem codes are asserted', () => {
    const r = new Set<string>();
    const p = new Set<string>();
    for (const { doc } of scenarios)
      walkValues(doc.then, (k, v) => {
        if (k === 'refusal' && typeof v === 'string') r.add(v);
        if (k === 'problem' && typeof v === 'string') p.add(v);
      });
    expect(r.size).toBeGreaterThanOrEqual(10);
    expect(p.size).toBeGreaterThanOrEqual(3);
  });
});

describe('extensibility scenarios (H1-H4)', () => {
  it('H2: an atomic batch creates 30 features, 10 for each of 3 participants', () => {
    const s = byName('batch_assign_30');
    const b = s.when.find((w) => w.kind === 'batch') as { atomic?: boolean; runs?: { input?: { zustaendig?: string } }[] } | undefined;
    expect(b?.atomic).toBe(true);
    expect(b?.runs?.length).toBe(30);
    const per = new Map<string, number>();
    for (const r of b?.runs ?? []) per.set(r.input?.zustaendig ?? '?', (per.get(r.input?.zustaendig ?? '?') ?? 0) + 1);
    expect([...per.values()].sort()).toEqual([10, 10, 10]);
  });

  it('H2: a refused item leaves no trace of the batch', () => {
    const s = byName('batch_atomic_rollback');
    expect(JSON.stringify(s.then)).toMatch(/batch_failed/);
    expect(JSON.stringify(s.then)).toMatch(/no_trace/);
  });

  it('H3: two roles have different app profiles', () => {
    const s = byName('role_app_profiles');
    const profiles = s.when.filter((w) => w.kind === 'app_profile');
    expect(profiles.length).toBeGreaterThanOrEqual(2);
    const t = s.then.steps as Record<string, { profile?: unknown }>;
    const seen = new Set(profiles.map((p) => JSON.stringify(t[p.id]?.profile)));
    expect(seen.size).toBe(profiles.length);
  });

  it('H4: an ephemeral view carries a runtime filter and is clipped by permissions', () => {
    const s = byName('ephemeral_view_clipped');
    const v = s.when.find((w) => w.kind === 'view') as { ephemeral?: { source?: { filter?: string } } } | undefined;
    expect(v?.ephemeral?.source?.filter).toBeTruthy();
    expect(JSON.stringify(s.then)).toMatch(/clipped/);
  });

  it('H1: a Z geometry round-trips unchanged', () => {
    const s = byName('geometry_z_roundtrip');
    const coords: number[][] = [];
    walkValues(s.given, (_k, v) => {
      if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')) coords.push(v as number[]);
    });
    walkValues(s.when, (_k, v) => {
      if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number')) coords.push(v as number[]);
    });
    expect(coords.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(s.then)).toMatch(/identical_to_input/);
  });
});
