// WP-043: derived relations with a full condition, proven on the golden veranstaltung template.
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import raw from '/fixtures/golden/templates/veranstaltung/1.0.0.yaml?raw';
import { condition } from '../expr';
import type { EvalContext, EvalValue, FeatureAccess } from '../expr';
import { createGeo } from '../geo';
import type { Polygon } from '../geo';
import type { Edge, FeatureId, Json, Key, RecordedObservation, RunId } from '../model';
import { TemplateFileSchema } from '../schema/file';
import { compile, foldSchema } from '../schema/compile';
import { createFold } from './index';
import type { DerivedLookup, EdgeChanges, FoldedFeature } from './contract';
import { goldenAssets } from '../testing/golden';
import { isServed } from '../registry/lifecycle';

const geo = createGeo();
const fold = createFold(geo);
const compiled = compile(TemplateFileSchema.parse(parse(raw)), { assets: goldenAssets });
if (!compiled.ok) throw new Error(JSON.stringify(compiled.problems));
const config = compiled.config;
const schema = foldSchema(config, 1);
const VERANSTALTUNG = 'veranstaltung' as Key;

const sq = (x: number, y: number, s: number): Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ],
  ],
});
let seq = 0;
const ob = (id: string, property: string, result: Json): RecordedObservation => ({
  featureId: id as FeatureId,
  property,
  result,
  seq: ++seq,
  runId: 'r' as RunId,
});
const json = (g: Polygon): Json => g as unknown as Json;

/** The adapter in miniature: an in-memory store whose `condition` runs the compiled expression. */
class Store {
  features = new Map<string, FoldedFeature>();
  edges: Edge[] = [];
  errors = 0;

  private access: FeatureAccess = {
    property: (id, key) => this.features.get(id)?.properties[key],
    related: () => [],
    history: () => [],
    type: (id) => this.features.get(id)?.type,
  };

  lookup: DerivedLookup = {
    near: (type, b) =>
      [...this.features.values()].filter(
        (f) =>
          f.type === type &&
          isServed(f.lifecycle) &&
          Object.values(f.derived).some(
            (d) => d.bbox[0] <= b[2] && d.bbox[2] >= b[0] && d.bbox[1] <= b[3] && d.bbox[3] >= b[1],
          ),
      ),
    typesDerivingTo: (t) =>
      [...schema.types].filter(([, ft]) => ft.derived.some((d) => d.to === t)).map(([k]) => k),
    edgesFrom: (id, rel) => this.edges.filter((e) => e.from === id && e.relation === rel),
    edgesTo: (id, rel) => this.edges.filter((e) => e.to === id && e.relation === rel),
    condition: (path, self, other) => {
      const typed = config.expressions.get(path)?.typed;
      if (!typed) return false;
      const ctx: EvalContext = {
        vars: new Map<string, EvalValue>([
          ['self', { $feature: self.id }],
          ['other', { $feature: other.id }],
        ]),
        features: this.access,
        now: '2026-09-29T00:00:00.000Z',
        relations: config.relations,
        geo,
      };
      const r = condition(typed, ctx);
      if (r.error) this.errors++;
      return r.value;
    },
  };

  /** Fold observations of one feature, then recompute when fold says derived inputs changed. */
  write(id: string, obs: RecordedObservation[]): FoldedFeature {
    const r = fold.feature(this.features.get(id), obs, schema);
    const f = r.feature as FoldedFeature;
    this.features.set(id, f);
    if (r.geometryChanged.length > 0 || r.derivedInputsChanged.length > 0) {
      this.apply(fold.recomputeDerived(f, this.lookup, schema));
    }
    return f;
  }
  private apply(c: EdgeChanges): void {
    const key = (e: Edge) => `${e.from}>${e.relation}>${e.to}`;
    const gone = new Set(c.remove.map(key));
    this.edges = [...this.edges.filter((e) => !gone.has(key(e))), ...c.put];
  }
  create(id: string, datum: string, g: Polygon): void {
    this.write(id, [ob(id, '$type', 'veranstaltung'), ob(id, 'datum', datum), ob(id, 'geometrie', json(g))]);
  }
  pairs(): string[] {
    return this.edges.map((e) => `${e.from}>${e.to}`).sort();
  }
}

describe('golden veranstaltung: kollision', () => {
  it('compile emits the condition, the prefilter and the inputs', () => {
    const ft = schema.types.get(VERANSTALTUNG);
    expect(ft?.derived[0]?.predicate).toBe('intersects');
    expect(ft?.derived[0]?.condition).toBe('types.veranstaltung.relations.kollision.derive');
    expect(ft?.derivedInputs).toEqual(['datum']);
  });

  it('same date + intersecting areas collide both ways; other dates and self do not', () => {
    const s = new Store();
    s.create('a', '2026-10-01', sq(0, 0, 2));
    s.create('b', '2026-10-01', sq(1, 1, 2));
    s.create('c', '2026-10-02', sq(1, 1, 2));
    s.create('d', '2026-10-01', sq(50, 50, 1));
    expect(s.pairs()).toEqual(['a>b', 'b>a']);
    expect(s.errors).toBe(0);
  });

  it('changing datum on either side recomputes the relation', () => {
    const s = new Store();
    s.create('a', '2026-10-01', sq(0, 0, 2));
    s.create('c', '2026-10-02', sq(1, 1, 2));
    expect(s.pairs()).toEqual([]);
    s.write('c', [ob('c', 'datum', '2026-10-01')]);
    expect(s.pairs()).toEqual(['a>c', 'c>a']);
    s.write('a', [ob('a', 'datum', '2026-10-03')]);
    expect(s.pairs()).toEqual([]);
  });

  it('fold lists a changed condition input, and only that', () => {
    const f = fold.feature(
      undefined,
      [ob('x', '$type', 'veranstaltung'), ob('x', 'datum', '2026-10-01'), ob('x', 'titel', 't')],
      schema,
    );
    expect(f.derivedInputsChanged).toEqual(['datum']);
    expect(fold.feature(f.feature, [ob('x', 'titel', 'u')], schema).derivedInputsChanged).toEqual([]);
    const g = fold.feature(f.feature, [ob('x', 'geometrie', json(sq(0, 0, 1)))], schema);
    expect(g.derivedInputsChanged).toEqual([]);
    expect(g.geometryChanged).toEqual(['geometrie']);
  });

  it('a condition that is false removes the edge', () => {
    const s = new Store();
    s.create('a', '2026-10-01', sq(0, 0, 2));
    s.create('b', '2026-10-01', sq(1, 1, 2));
    const never: DerivedLookup = { ...s.lookup, condition: () => false };
    const f = s.features.get('a') as FoldedFeature;
    expect(
      fold
        .recomputeDerived(f, never, schema)
        .remove.map((e) => `${e.from}>${e.to}`)
        .sort(),
    ).toEqual(['a>b', 'b>a']);
  });

  it('a condition that cannot evaluate yields no edge (evaluation is total)', () => {
    const s = new Store();
    s.create('a', '2026-10-01', sq(0, 0, 2));
    s.write('b', [ob('b', '$type', 'veranstaltung'), ob('b', 'geometrie', json(sq(1, 1, 2)))]);
    expect(s.pairs()).toEqual([]);
  });
});

describe('single predicate derive', () => {
  it('has no condition and no inputs', () => {
    const src = parse(raw) as { types: Record<string, { relations: Record<string, { derive: string }> }> };
    const rel = src.types['veranstaltung']?.relations['kollision'];
    if (!rel) throw new Error('fixture changed');
    rel.derive = 'intersects(self.geometrie, other.geometrie)';
    const c = compile(TemplateFileSchema.parse(src), { assets: goldenAssets });
    if (!c.ok) throw new Error(JSON.stringify(c.problems));
    const ft = foldSchema(c.config, 1).types.get(VERANSTALTUNG);
    expect(ft?.derived[0]?.condition).toBeUndefined();
    expect(ft?.derivedInputs).toBeUndefined();
  });
});
