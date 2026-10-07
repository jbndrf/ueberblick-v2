import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse } from 'yaml';
import { compile as compileWith, diff, problemsFromMergeIssues } from './index';
import { PROBLEM_CODES } from '../../registry/compile';
import { TemplateFileSchema, type OverlayFile, type TemplateFile } from '../file';
import { merge } from '../../template';
import type { Problem } from './contract';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

const raw = import.meta.glob('./__fixtures__/*.yaml', { query: '?raw', import: 'default', eager: true });
const load = (name: string): unknown => parse(raw[`./__fixtures__/${name}.yaml`] as string);
const golden = import.meta.glob('/fixtures/golden/templates/*/*.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const MERGE_CODES: readonly string[] = [
  'lock_violation',
  'unknown_path',
  'path_exists',
  'hidden_referenced',
  'schema_invalid', // reported by the builder document (WP-200), not by compile
];
const clone = <T>(x: T): T => structuredClone(x);
const baseFile = (): TemplateFile => TemplateFileSchema.parse(load('base'));

/** Sets a dotted path in a plain object, creating objects on the way. */
function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts.slice(0, -1)) {
    cur[p] ??= {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
}

interface Case {
  name: string;
  code: string;
  path: string;
  warning?: boolean;
  set: Record<string, unknown>;
}
const cases = load('cases') as Case[];

function patched(c: Case): TemplateFile {
  const f = clone(baseFile()) as unknown as Record<string, unknown>;
  for (const [p, v] of Object.entries(c.set)) setPath(f, p, v);
  return TemplateFileSchema.parse(f);
}

const all = (r: ReturnType<typeof compile>): readonly Problem[] => (r.ok ? r.warnings : r.problems);

describe('compile: the clean base', () => {
  it('compiles without problems or warnings', () => {
    const r = compile(baseFile());
    expect(all(r)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('exposes checked expressions, tasks by type and automatic actions by trigger', () => {
    const r = compile(baseFile());
    if (!r.ok) throw new Error('expected ok');
    expect(r.config.expressions.get('tasks.kontrolle.when')?.source).toContain("self.stage != 'erledigt'");
    expect(r.config.expressions.get('tasks.kontrolle.form.foto.relevant')?.typed.type.kind).toBe('bool');
    expect(r.config.tasksByType.get('baum')).toEqual(['kontrolle', 'abschliessen']);
    expect(r.config.tasksByType.get('$none')).toEqual(['melden']);
    expect(r.config.autosByTrigger.get('task.kontrolle')).toEqual(['melden.spielplatz_melden']);
    expect(r.config.autos.get('melden.spielplatz_melden')?.task).toBe('melden');
  });

  it('hashes by content, not by the key order of unordered objects (ordered maps count: A-042)', () => {
    const a = baseFile();
    const b = { ...(Object.fromEntries(Object.entries(a).reverse()) as TemplateFile) };
    const ra = compile(a);
    const rb = compile(b);
    if (!ra.ok || !rb.ok) throw new Error('expected ok');
    expect(ra.config.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rb.config.hash).toBe(ra.config.hash);
    const c = clone(a);
    c.template.version = '1.0.1';
    const rc = compile(c);
    if (!rc.ok) throw new Error('expected ok');
    expect(rc.config.hash).not.toBe(ra.config.hash);
  });
});

describe('compile: visible_when_not_sql', () => {
  const withVisible = (visible: string): TemplateFile => {
    const f = clone(baseFile()) as unknown as Record<string, unknown>;
    setPath(f, 'types.baum.permissions', { see: '$all', visible_when: visible });
    return TemplateFileSchema.parse(f);
  };
  it('names the path, the span, the reason and a hint', () => {
    const r = compile(withVisible('within(self.standort, self.standort)'));
    const w = all(r).find((p) => p.code === 'visible_when_not_sql');
    expect(r.ok).toBe(true);
    expect(w?.path).toBe('types.baum.permissions.visible_when');
    expect(w?.span).toBeDefined();
    expect(w?.message.length).toBeGreaterThan(0);
    expect(w?.message).toMatch(/hides/i);
    expect(w?.hint).toMatch(/rewrite/i);
  });
  it('is silent for translatable filters (the actor is bound)', () => {
    const r = compile(
      withVisible("self.stage == 'erfasst' || 'kontrolle' in actor.roles || self.stage == actor.id"),
    );
    expect(all(r).filter((p) => p.code === 'visible_when_not_sql')).toEqual([]);
  });
});

/** Deploy-time codes: not raised by `compile`, so they are proven in the deploy specs (packages/server/src/deploy). */
const DEPLOY_CODES: readonly string[] = [];

describe('compile: negative fixtures', () => {
  it('has a fixture for every problem code except the merge and deploy codes', () => {
    const covered = new Set(cases.map((c) => c.code));
    for (const k of PROBLEM_CODES.keys) {
      if (MERGE_CODES.includes(k) || DEPLOY_CODES.includes(k)) continue;
      expect(covered.has(k), `no negative fixture for ${k}`).toBe(true);
    }
  });

  for (const c of cases) {
    it(c.name, () => {
      const r = compile(patched(c));
      const problems = all(r);
      const hit = problems.filter((p) => p.code === c.code && p.path.startsWith(c.path));
      expect(hit.length, JSON.stringify(problems, null, 1)).toBeGreaterThan(0);
      expect(r.ok).toBe(c.warning === true);
      for (const p of problems) {
        expect(p.path.length).toBeGreaterThan(0);
        expect(p.hint?.length ?? 0, `hint missing on ${p.code} at ${p.path}`).toBeGreaterThan(0);
        expect(PROBLEM_CODES.has(p.code)).toBe(true);
      }
    });
  }

  it('reports a span for problems inside an expression', () => {
    const r = compile(patched(cases.find((c) => c.name === 'when does not parse') as Case));
    const p = all(r).find((x) => x.code === 'expression_parse');
    expect(p?.span).toBeDefined();
    const t = compile(patched(cases.find((c) => c.name === 'when uses an unknown property') as Case));
    expect(all(t).find((x) => x.code === 'expression_type')?.span).toBeDefined();
  });

  it('collects all problems, not only the first', () => {
    const both = {
      name: '',
      code: '',
      path: '',
      set: { 'tasks.kontrolle.on': 'nix', 'tasks.kontrolle.when': 'self.x ==' },
    };
    const r = compile(patched(both));
    expect(all(r).length).toBeGreaterThanOrEqual(2);
  });
});

describe('compile: problems from the real template.merge', () => {
  const overlayOf = (over: Partial<OverlayFile>): OverlayFile => ({
    schema: 'ueberblick/1',
    extends: 'baumkataster@1',
    ...over,
  });
  const problemsOf = (over: Partial<OverlayFile>) =>
    problemsFromMergeIssues(merge(baseFile(), overlayOf(over)).issues);

  it.each([
    ['lock_violation', { override: { 'types.baum.properties.stage.options.erfasst': 'Neu' } }],
    ['unknown_path', { override: { 'types.baum.properties.nix.label': 'x' } }],
    ['path_exists', { add: { 'tasks.melden': { label: 'x', on: 'none' } } }],
    ['hidden_referenced', { hide: ['tasks.kontrolle'] }],
  ] as const)('%s becomes a problem with a path and a hint', (code, over) => {
    const ps = problemsOf(over as Partial<OverlayFile>);
    expect(ps.map((p) => p.code)).toContain(code);
    for (const p of ps) {
      expect(p.path.length).toBeGreaterThan(0);
      expect(p.hint?.length).toBeGreaterThan(0);
      expect(PROBLEM_CODES.has(p.code)).toBe(true);
    }
  });

  it('a clean merge compiles', () => {
    const m = merge(baseFile(), overlayOf({ override: { 'types.baum.label': 'Baeume' } }));
    expect(m.issues).toEqual([]);
    expect(compile(m.file).ok).toBe(true);
  });
});

describe('compile: extensibility (H1, H3, H4)', () => {
  it('accepts a standalone view without a role or task (H4)', () => {
    const f = clone(baseFile());
    f.views = { ...f.views, kurz: { source: { type: 'baum', filter: "self.stage == 'erfasst'" } } };
    expect(compile(f).ok).toBe(true);
  });
  it('checks layer sources and renderer keys (H1)', () => {
    const f = clone(baseFile());
    f.views = {
      ...f.views,
      k2: {
        source: { type: 'baum' },
        layers: { l: { source: { type: 'nix' }, renderer: 'maplibre-2d' } },
      },
    };
    const r = compile(f);
    expect(all(r).some((p) => p.path === 'views.k2.layers.l.source.type')).toBe(true);
  });
  it('checks app profile views and tools list shape (H3)', () => {
    const f = clone(baseFile());
    f.roles = { ...f.roles, x: { label: 'X', app: { views: { karte: {}, nix: {} } } } };
    const r = compile(f);
    expect(all(r).some((p) => p.path.startsWith('roles.x.app.views'))).toBe(true);
  });
});

describe('compile: golden templates', () => {
  it('every golden template parses and compiles, with no allowance', () => {
    let compiled = 0;
    for (const [file, src] of Object.entries(golden)) {
      const parsed = TemplateFileSchema.safeParse(parse(src as string));
      expect(parsed.success, file).toBe(true);
      if (!parsed.success) continue;
      const r = compile(parsed.data);
      expect(r.ok ? [] : r.problems, file).toEqual([]);
      compiled++;
    }
    expect(compiled).toBe(Object.keys(golden).length);
  });

  it('personal_public follows the effective see audience', () => {
    const codes = (permissions: unknown): string[] => {
      const f = clone(baseFile()) as unknown as Record<string, unknown>;
      setPath(f, 'types.baum.properties.befund', { type: 'text', personal: { subject: 'feature' } });
      setPath(f, 'types.baum.permissions', permissions);
      return all(compile(TemplateFileSchema.parse(f))).map((p) => p.code);
    };
    // absent see denies everyone (F6): nothing to warn about
    expect(codes({ create: ['kontrolle'] })).not.toContain('personal_public');
    expect(codes({ see: ['kontrolle'] })).not.toContain('personal_public');
    expect(codes({ see: { befund: ['kontrolle'] } })).not.toContain('personal_public');
    expect(codes({ see: '$all' })).toContain('personal_public');
  });

  it('a golden template marks personal properties and carries no personal warning', () => {
    let personal = 0;
    for (const src of Object.values(golden)) {
      const parsed = TemplateFileSchema.parse(parse(src as string));
      for (const t of Object.values(parsed.types ?? {}))
        personal += Object.values(t.properties).filter((p) => p.personal !== undefined).length;
      const r = compile(parsed);
      expect(all(r).filter((p) => p.code.startsWith('personal_'))).toEqual([]);
    }
    expect(personal).toBeGreaterThan(0);
  });
});

describe('compile: personal_without_redact', () => {
  const withPersonal = (extra: Record<string, unknown> = {}): TemplateFile => {
    const f = clone(baseFile()) as unknown as Record<string, unknown>;
    setPath(f, 'types.baum.properties.befund', { type: 'text', personal: { subject: 'feature' } });
    setPath(f, 'types.baum.properties.melder', { type: 'participant', personal: { subject: 'actor' } });
    for (const [p, v] of Object.entries(extra)) setPath(f, p, v);
    return TemplateFileSchema.parse(f);
  };
  const erasure = {
    'tasks.loeschen': {
      label: 'Loeschen',
      on: 'none',
      then: [{ redact: { subject: 'actor', of: 'actor.id' } }],
    },
  };
  const hits = (file: TemplateFile): readonly Problem[] =>
    all(compile(file)).filter((p) => p.code === 'personal_without_redact');

  it('warns exactly once, naming every personal property key, and stays a warning', () => {
    const file = withPersonal();
    const r = compile(file);
    expect(r.ok).toBe(true);
    const w = hits(file);
    expect(w).toHaveLength(1);
    expect(w[0]?.message).toContain('baum.befund');
    expect(w[0]?.message).toContain('baum.melder');
    expect(w[0]?.hint).toContain('redact');
  });

  it('is silent when a task has a redact step', () => {
    expect(hits(withPersonal(erasure))).toEqual([]);
  });

  it('is silent when no property is personal', () => {
    expect(hits(baseFile())).toEqual([]);
  });
});

describe('diff', () => {
  it('is empty for equal files', () => {
    expect(diff(baseFile(), clone(baseFile()))).toEqual([]);
  });
  it('reports added, changed and removed', () => {
    const a = baseFile();
    const b = clone(a);
    (b.tasks as Record<string, unknown>)['neu'] = { label: 'Neu', on: 'none' };
    b.template.version = '1.1.0';
    delete (b.tasks as Record<string, unknown>)['melden'];
    const d = diff(a, b);
    expect(d.find((e) => e.path === 'tasks.neu')).toMatchObject({ change: 'added', breaking: false });
    expect(d.find((e) => e.path === 'tasks.melden')).toMatchObject({ change: 'removed' });
    expect(d.find((e) => e.path === 'template.version')).toMatchObject({
      change: 'changed',
      before: '1.0.0',
      after: '1.1.0',
      breaking: false,
    });
  });
  it('marks removed types, properties, options and changed property types as breaking', () => {
    const a = baseFile();
    const b = clone(a);
    const baum = (
      b.types as Record<
        string,
        { properties: Record<string, { type: string; options?: Record<string, string> }> }
      >
    )['baum'];
    delete baum?.properties['befund'];
    delete baum?.properties['stage']?.options?.['erledigt'];
    if (baum) (baum.properties['faellig_am'] as { type: string }).type = 'text';
    delete (b.types as Record<string, unknown>)['flaeche'];
    const d = diff(a, b);
    const breaking = d.filter((e) => e.breaking).map((e) => e.path);
    expect(breaking).toEqual(
      expect.arrayContaining([
        'types.baum.properties.befund',
        'types.baum.properties.stage.options.erledigt',
        'types.baum.properties.faellig_am.type',
        'types.flaeche',
      ]),
    );
  });
  it('does not mark label changes or additions as breaking', () => {
    const a = baseFile();
    const b = clone(a);
    setPath(b as unknown as Record<string, unknown>, 'types.baum.label', 'Bäume');
    setPath(b as unknown as Record<string, unknown>, 'types.baum.properties.neu', { type: 'text' });
    expect(diff(a, b).some((e) => e.breaking)).toBe(false);
  });
  it('property: diff(a, a) is empty and added/removed mirror each other', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom<string>('melden', 'kontrolle', 'abschliessen'), { maxLength: 3 }),
        (drop) => {
          const a = baseFile();
          const b = clone(a);
          b.tasks = Object.fromEntries(Object.entries(b.tasks ?? {}).filter(([k]) => !drop.includes(k)));
          expect(diff(a, a)).toEqual([]);
          const fwd = diff(a, b);
          const back = diff(b, a);
          expect(
            fwd
              .filter((e) => e.change === 'removed')
              .map((e) => e.path)
              .sort(),
          ).toEqual(
            back
              .filter((e) => e.change === 'added')
              .map((e) => e.path)
              .sort(),
          );
        },
      ),
    );
  });
});
