// WP-013.1: set-value rule, select typing, relation cardinality, sigil keywords, key paths, derived views.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { RESERVED_KEYS } from '../../registry/compile';
import { breakingChanges } from '../../template';
import { parentPath } from '../../template/paths';
import type { Key } from '../../model';
import { TemplateFileSchema, type TemplateFile } from '../file';
import { compile as compileWith, diff, foldSchema, hydrate, serialize } from './index';
import type { CompileResult, CompiledConfig, Problem } from './contract';
import { goldenAssets } from '../../testing/golden';
/** Compiles with the golden bundle, so `$ref` layer styles resolve (WP-577). */
const compile = (f: Parameters<typeof compileWith>[0]) => compileWith(f, { assets: goldenAssets });

const raw = import.meta.glob('./__fixtures__/base.yaml', { query: '?raw', import: 'default', eager: true });
const base = (): Record<string, unknown> => parse(Object.values(raw)[0] as string) as Record<string, unknown>;

/** The base file with dotted paths set to values, parsed through the schema. */
function patched(sets: Record<string, unknown>): TemplateFile {
  const f = base();
  for (const [path, value] of Object.entries(sets)) {
    const parts = path.split('.');
    let cur = f;
    for (const p of parts.slice(0, -1)) {
      cur[p] ??= {};
      cur = cur[p] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1] as string;
    if (value === undefined) Reflect.deleteProperty(cur, last);
    else cur[last] = value;
  }
  return TemplateFileSchema.parse(f);
}
const k = (s: string): Key => s as Key;
const problems = (r: CompileResult): readonly Problem[] => (r.ok ? r.warnings : r.problems);
const errorsAt = (r: CompileResult, path: string): Problem[] =>
  problems(r).filter((p) => p.path === path && p.code !== 'dead_option');
const okConfig = (r: CompileResult): CompiledConfig => {
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
};

describe('then.set: a string is always an expression (A-004 item 9)', () => {
  const withStep = (value: unknown, extra: Record<string, unknown> = {}): TemplateFile =>
    patched({ 'tasks.abschliessen.then': [{ set: { stage: value } }], ...extra });
  const path = 'tasks.abschliessen.then["0"].set.stage';

  it('a quoted literal is the way to write an option key', () => {
    expect(errorsAt(compile(withStep("'erledigt'")), path)).toEqual([]);
  });

  it('a bare identifier equal to an option key is an expression_type problem with the quoting hint', () => {
    const p = errorsAt(compile(withStep('erledigt')), path);
    expect(p.map((x) => x.code)).toEqual(['expression_type']);
    expect(p[0]?.hint).toContain(`"'erledigt'"`);
  });

  it('a string literal that is no option of the target is reported', () => {
    const p = errorsAt(compile(withStep("'geprueft'")), path);
    expect(p.map((x) => x.code)).toEqual(['dangling_reference']);
  });

  it('an expression over form values is checked as an expression', () => {
    const r = compile(patched({ 'tasks.kontrolle.then': [{ set: { befund: 'form.befund' } }] }));
    expect(errorsAt(r, 'tasks.kontrolle.then["0"].set.befund')).toEqual([]);
  });

  it('non-string scalars are literals and are checked against the property type', () => {
    const props = { 'types.baum.properties.zaehler': { type: 'integer' } };
    const good = patched({ ...props, 'tasks.abschliessen.then': [{ set: { zaehler: 3 } }] });
    expect(errorsAt(compile(good), 'tasks.abschliessen.then["0"].set.zaehler')).toEqual([]);
    const bad = patched({ ...props, 'tasks.abschliessen.then': [{ set: { zaehler: true } }] });
    expect(errorsAt(compile(bad), 'tasks.abschliessen.then["0"].set.zaehler').map((p) => p.code)).toEqual([
      'expression_type',
    ]);
  });

  it('a quoted literal counts as setting the option (no dead_option for it)', () => {
    const dead = problems(compile(withStep("'erledigt'"))).filter(
      (p) => p.code === 'dead_option' && p.path.endsWith('.erledigt'),
    );
    expect(dead).toEqual([]);
  });
});

describe('selects are string-typed', () => {
  it('compares an option key with a string and rejects a number', () => {
    expect(compile(patched({ 'tasks.abschliessen.when': "self.vitalitaet == 'v3'" })).ok).toBe(true);
    const bad = compile(patched({ 'tasks.abschliessen.when': 'self.vitalitaet == 3' }));
    expect(errorsAt(bad, 'tasks.abschliessen.when').map((p) => p.code)).toEqual(['expression_type']);
  });
});

describe('relations are typed by cardinality', () => {
  const nachbarn = { to: 'baum', derive: 'self != other && within(self.standort, other.standort)' };
  const flaeche = { to: 'flaeche', derive: 'within(self.standort, other.umriss)' };
  const check = (baumRelations: unknown, when: string): Problem[] =>
    errorsAt(
      compile(
        patched({
          'types.baum.relations': baumRelations,
          'types.flaeche.relations': { baeume: { to: 'baum', inverse_of: 'baum.flaeche' } },
          'tasks.abschliessen.when': when,
        }),
      ),
      'tasks.abschliessen.when',
    );

  it('cardinality one yields a feature', () => {
    expect(check({ flaeche: { ...flaeche, cardinality: 'one' } }, "self.flaeche.name == 'x'")).toEqual([]);
  });

  it('derive without cardinality yields a list of features, not a feature', () => {
    const rels = { flaeche: { ...flaeche, cardinality: 'one' }, nachbarn };
    expect(check(rels, 'size(self.nachbarn) == 0')).toEqual([]);
    expect(check(rels, "self.nachbarn.stage == 'x'").map((p) => p.code)).toEqual(['expression_type']);
  });

  it('cardinality many written out equals the default', () => {
    const rels = {
      flaeche: { ...flaeche, cardinality: 'one' },
      nachbarn: { ...nachbarn, cardinality: 'many' },
    };
    expect(check(rels, "self.nachbarn.filter(b, b.stage == 'erfasst').size() == 0")).toEqual([]);
  });

  it('inverse_of yields a list, and macros work over it', () => {
    const r = compile(
      patched({
        'types.baum.relations': { flaeche: { ...flaeche, cardinality: 'one' } },
        'types.flaeche.relations': { baeume: { to: 'baum', inverse_of: 'baum.flaeche' } },
        'tasks.pruefen': {
          label: 'Prüfen',
          on: 'flaeche',
          when: "self.baeume.exists(b, b.stage == 'erfasst') && self.baeume.all(b, has(b.befund))",
        },
      }),
    );
    expect(errorsAt(r, 'tasks.pruefen.when')).toEqual([]);
  });
});

describe('sigil keywords and reserved keys', () => {
  it('RESERVED_KEYS holds only rule-language names, literals and `in`', () => {
    expect([...RESERVED_KEYS.keys].sort()).toEqual(
      ['self', 'form', 'value', 'actor', 'inputs', 'other', 'now', 'true', 'false', 'null', 'in'].sort(),
    );
  });

  it('a key equal to a reserved word is a reserved_key problem; map, none and all are ordinary keys', () => {
    const none = { label: 'x', on: '$none' };
    const r = compile(
      patched({ 'tasks.self': none, 'tasks.map': none, 'tasks.none': none, 'tasks.all': none }),
    );
    expect(
      problems(r)
        .filter((p) => p.code === 'reserved_key')
        .map((p) => p.path),
    ).toEqual(['tasks.self']);
  });

  it('$map tasks are offered under $map, $none under $none', () => {
    const c = okConfig(
      compile(patched({ 'tasks.erfassen': { label: 'Erfassen', on: '$map', creates: 'baum' } })),
    );
    expect(c.tasksByType.get('$map')).toEqual(['erfassen']);
    expect(c.tasksByType.get('$none')).toEqual(['melden']);
  });

  it('creates must name a feature type', () => {
    const r = compile(patched({ 'tasks.erfassen': { label: 'Erfassen', on: '$map', creates: 'nix' } }));
    expect(errorsAt(r, 'tasks.erfassen.creates').map((p) => p.code)).toEqual(['dangling_reference']);
  });

  it('with `creates`, form fields and set targets address the created type; self stays the primary feature', () => {
    const r = compile(
      patched({
        'types.massnahme': {
          label: 'Maßnahme',
          permissions: { write: '$all' },
          properties: { baum: { type: 'reference', to: 'baum' }, art: { type: 'text' } },
        },
        'tasks.anlegen': {
          label: 'Anlegen',
          on: 'baum',
          creates: 'massnahme',
          form: { art: {} },
          then: [{ set: { baum: 'self' } }],
        },
      }),
    );
    expect(problems(r).filter((p) => p.path.startsWith('tasks.anlegen'))).toEqual([]);
  });
});

describe('key paths are built with formatKeyPath', () => {
  it('expression paths inside lists are bracketed strings', () => {
    const c = okConfig(compile(TemplateFileSchema.parse(base())));
    expect(c.expressions.has('tasks.kontrolle.then["1"].when')).toBe(true);
    expect(c.expressions.has('tasks.kontrolle.then["3"].set.faellig_am')).toBe(true);
  });

  it('diff addresses a bracketed label key and a style key with brackets', () => {
    const a = patched({ 'types.baum.label': { de: 'Baum', 'en-GB': 'Tree' } });
    const b = patched({ 'types.baum.label': { de: 'Baum', 'en-GB': 'Trees' } });
    expect(diff(a, b).map((e) => e.path)).toEqual(['types.baum.label["en-GB"]']);
    const c = patched({ 'views.karte.layers.baeume.style': { 'circle-color': 'red' } });
    const d = patched({ 'views.karte.layers.baeume.style': { 'circle-color': 'blue' } });
    expect(diff(c, d).map((e) => e.path)).toEqual(['views.karte.layers.baeume.style["circle-color"]']);
  });

  it('a problem path inside a list is a parseable key path', () => {
    const r = compile(patched({ 'tasks.kontrolle.then': [{ set: { stadium: "'x'" } }] }));
    const p = problems(r).find((x) => x.code === 'dangling_reference' && x.path.includes('then'));
    expect(p?.path).toBe('tasks.kontrolle.then["0"].set.stadium');
  });
});

describe('derived views come from compile and survive hydrate', () => {
  const golden = import.meta.glob('/fixtures/golden/templates/veranstaltung/1.0.0.yaml', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const compiled = (): CompiledConfig =>
    okConfig(compile(TemplateFileSchema.parse(parse(Object.values(golden)[0] as string))));

  it('relations lists declared relations and reference properties per type', () => {
    const c = compiled();
    expect([...(c.relations.get(k('veranstaltung')) ?? [])].sort()).toEqual(['auflagen', 'kollision']);
    expect([...(c.relations.get(k('auflage')) ?? [])]).toEqual(['veranstaltung']);
  });

  it('foldSchema lists geometry properties and reference edges', () => {
    const s = foldSchema(compiled(), 7);
    expect(s.configVersion).toBe(7);
    expect(s.types.get(k('auflage'))?.references).toEqual([
      { property: 'veranstaltung', relation: 'veranstaltung', to: 'veranstaltung' },
    ]);
    expect(s.types.get(k('veranstaltung'))?.geometryProperties).toEqual(['geometrie']);
  });

  it('a pure predicate derive becomes a FoldDerivedRelation', () => {
    const s = foldSchema(okConfig(compile(TemplateFileSchema.parse(base()))), 1);
    expect(s.types.get(k('baum'))?.derived).toEqual([
      {
        relation: 'flaeche',
        to: 'flaeche',
        predicate: 'within',
        selfProperty: 'standort',
        otherProperty: 'umriss',
      },
    ]);
  });

  it('hydrate rebuilds the same views without the checker', () => {
    const c = compiled();
    const h = hydrate(JSON.parse(JSON.stringify(serialize(c))));
    expect(h.relations).toEqual(c.relations);
    expect(h.foldTypes).toEqual(c.foldTypes);
  });
});

describe('one breaking-change rule', () => {
  const golden = import.meta.glob('/fixtures/golden/{templates,candidates}/baumkataster/*.yaml', {
    query: '?raw',
    import: 'default',
    eager: true,
  });
  const files = Object.values(golden).map((src) => TemplateFileSchema.parse(parse(src as string)));

  /** The paths diff calls breaking, expressed as the entity paths `breakingChanges` uses. */
  const viaDiff = (a: TemplateFile, b: TemplateFile): string[] =>
    diff(a, b)
      .filter((e) => e.breaking)
      .map((e) =>
        /(\.type|\.geometry_type|\.cardinality)$/.test(e.path) ? (parentPath(e.path) ?? e.path) : e.path,
      )
      .sort();
  const viaTemplate = (a: TemplateFile, b: TemplateFile): string[] =>
    breakingChanges(a, b)
      .map((c) => c.path)
      .sort();

  it('diff and template.breakingChanges flag the same paths for every pair of golden versions', () => {
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const a of files) for (const b of files) expect(viaDiff(a, b)).toEqual(viaTemplate(a, b));
  });

  it('a changed, added or removed geometry_type is breaking in both', () => {
    const a = TemplateFileSchema.parse(base());
    const b = patched({ 'types.baum.properties.standort.geometry_type': 'polygon' });
    expect(viaTemplate(a, b)).toEqual(['types.baum.properties.standort']);
    expect(viaDiff(a, b)).toEqual(viaTemplate(a, b));
    expect(breakingChanges(a, b)[0]?.kind).toBe('type_changed');
    const c = patched({ 'types.baum.properties.standort.geometry_type': undefined });
    expect(viaTemplate(a, c)).toEqual(['types.baum.properties.standort']);
    expect(viaDiff(a, c)).toEqual(viaTemplate(a, c));
    expect(viaTemplate(a, a)).toEqual([]);
  });

  it('Mehrfachauswahl off (many to one) is breaking in both, one to many is not (A-048)', () => {
    const one = patched({
      'types.baum.properties.team': { type: 'participant' },
    });
    const many = patched({
      'types.baum.properties.team': { type: 'participant', cardinality: 'many' },
    });
    expect(viaTemplate(many, one)).toEqual(['types.baum.properties.team']);
    expect(viaDiff(many, one)).toEqual(viaTemplate(many, one));
    expect(breakingChanges(many, one)[0]?.kind).toBe('type_changed');
    const explicit = patched({
      'types.baum.properties.team': { type: 'participant', cardinality: 'one' },
    });
    expect(viaTemplate(many, explicit)).toEqual(['types.baum.properties.team']);
    expect(viaDiff(many, explicit)).toEqual(viaTemplate(many, explicit));
    expect(viaTemplate(one, many)).toEqual([]);
    expect(viaDiff(one, many)).toEqual([]);
  });

  it('removed tasks, views, options and changed property types are breaking in both', () => {
    const a = TemplateFileSchema.parse(base());
    const b = patched({
      'types.baum.properties.befund.type': 'integer',
      'types.baum.properties.stage.options': { erfasst: 'Erfasst' },
      'tasks.abschliessen': undefined,
      'views.meine_aufgaben': undefined,
    });
    expect(viaDiff(a, b)).toEqual(viaTemplate(a, b));
    expect(viaDiff(a, b)).toEqual(
      expect.arrayContaining([
        'tasks.abschliessen',
        'views.meine_aufgaben',
        'types.baum.properties.befund',
        'types.baum.properties.stage.options.erledigt',
      ]),
    );
  });
});
