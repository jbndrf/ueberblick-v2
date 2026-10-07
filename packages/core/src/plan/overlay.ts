/**
 * The planner's own layer over the `Facts` port: observations planned earlier in the batch (and by
 * earlier steps and rule runs of the same run) become visible to later ones, folded with core.fold.
 * It never mutates `facts` and is discarded with the plan, so a refused batch leaves no trace (H2).
 */
import type { Bbox } from '../geo/contract';
import { bboxIntersects } from '../geo/bbox';
import type { DerivedLookup, Fold, FoldedFeature, FoldSchema } from '../fold/contract';
import { edgeKey } from '../fold/edge-key';
import type {
  Edge,
  FeatureId,
  FeatureState,
  Json,
  Key,
  Observation,
  RecordedObservation,
  RunId,
} from '../model';
import type { Facts } from '../ports';
import type { CompiledConfig } from '../schema/compile/contract';
import { condition } from '../expr/evaluate';
import type { EvalContext } from '../expr/contract';
import { isGeometry } from '../fold/state';
import type { PlanPorts } from './contract';
import { featureAccess } from './access';
import { isServed } from '../registry/lifecycle';

/** A property whose value differs after an observation was applied (input of `change` triggers). */
export interface Change {
  readonly featureId: FeatureId;
  readonly type: Key;
  readonly property: string;
  readonly before: Json | undefined;
  readonly after: Json;
}

const sameJson = (a: Json | undefined, b: Json | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

export class Overlay implements Facts {
  private readonly features = new Map<FeatureId, FoldedFeature>();
  private readonly observations = new Map<FeatureId, RecordedObservation[]>();
  private readonly put = new Map<string, Edge>();
  private readonly removed = new Set<string>();
  /** Per run: the edges it really added (not there before) and really removed (there before); input of `{ when }` (A-045). */
  private readonly edgeLog = new Map<RunId, { added: Map<string, Edge>; removed: Map<string, Edge> }>();

  constructor(
    private readonly base: Facts,
    private readonly fold: Fold,
    private readonly schema: FoldSchema,
    private readonly config: CompiledConfig,
    private readonly ports: Pick<PlanPorts, 'clock' | 'geo'>,
    /** The schema a feature is folded under (A-029): its own version's. Default: `schema` for every feature. */
    private readonly schemaOf: (id: FeatureId) => FoldSchema = () => schema,
  ) {}

  feature(id: FeatureId): FeatureState | undefined {
    return this.features.get(id) ?? this.base.feature(id);
  }

  near(type: Key, bbox: Bbox): Iterable<FeatureState> {
    const out: FeatureState[] = [];
    for (const f of this.base.near(type, bbox)) if (!this.features.has(f.id)) out.push(f);
    for (const f of this.features.values())
      if (
        f.type === type &&
        isServed(f.lifecycle) &&
        Object.values(f.derived).some((d) => bboxIntersects(d.bbox, bbox))
      )
        out.push(f);
    return out;
  }

  ofType(type: Key): Iterable<FeatureState> {
    const out: FeatureState[] = [];
    for (const f of this.base.ofType(type)) if (!this.features.has(f.id)) out.push(f);
    for (const f of this.features.values()) if (f.type === type && isServed(f.lifecycle)) out.push(f);
    return out;
  }

  edgesFrom(id: FeatureId, relation?: Key): readonly Edge[] {
    return this.edges(
      this.base.edgesFrom(id, relation),
      (e) => e.from === id && (relation === undefined || e.relation === relation),
    );
  }

  edgesTo(id: FeatureId, relation?: Key): readonly Edge[] {
    return this.edges(
      this.base.edgesTo(id, relation),
      (e) => e.to === id && (relation === undefined || e.relation === relation),
    );
  }

  history(id: FeatureId, property: string, limit: number): readonly RecordedObservation[] {
    const mine = (this.observations.get(id) ?? []).filter((o) => o.property === property).reverse();
    if (mine.length >= limit) return mine.slice(0, limit);
    return [...mine, ...this.base.history(id, property, limit - mine.length)];
  }

  /** Erasure reads committed state: what earlier runs of the same batch wrote is not attributed to an actor here. */
  observationsByActor(actorId: string): readonly RecordedObservation[] {
    return this.base.observationsByActor(actorId);
  }

  /** Committed state; `quota.ts` adds the features created earlier in the same batch. */
  createdBy(actorId: string, limit: number): number {
    return this.base.createdBy(actorId, limit);
  }

  featuresWith(type: Key, property: string, value: Json): Iterable<FeatureState> {
    return this.base.featuresWith(type, property, value);
  }

  private edges(base: readonly Edge[], mine: (e: Edge) => boolean): readonly Edge[] {
    const out = base.filter((e) => !this.removed.has(edgeKey(e)));
    for (const e of this.put.values()) if (mine(e)) out.push(e);
    return out;
  }

  /** The folded state of a feature (the base state gets empty derived values until its geometry changes). */
  private folded(id: FeatureId): FoldedFeature | undefined {
    const own = this.features.get(id);
    if (own !== undefined) return own;
    const base = this.base.feature(id);
    return base === undefined ? undefined : { ...base, derived: {} };
  }

  /** Applies one run's observations in order; returns the properties whose value changed. */
  apply(runId: RunId, observations: readonly Observation[]): readonly Change[] {
    const changes: Change[] = [];
    for (const o of observations) {
      const prev = this.folded(o.featureId);
      const rec: RecordedObservation = { ...o, runId, seq: (prev?.updatedSeq ?? 0) + 1 };
      this.observations.set(o.featureId, [...(this.observations.get(o.featureId) ?? []), rec]);
      const schema = this.schemaOf(o.featureId);
      const r = this.fold.feature(prev, [rec], schema);
      if (r.feature === undefined) continue;
      this.features.set(o.featureId, r.feature);
      this.edgeChanges(runId, r.edges);
      if (r.geometryChanged.length > 0 || r.derivedInputsChanged.length > 0) {
        const f = this.withDerived(r.feature, schema);
        this.features.set(o.featureId, f);
        this.edgeChanges(runId, this.fold.recomputeDerived(f, this.lookup(), schema));
      }
      const before = prev?.properties[o.property];
      if (!o.property.startsWith('$') && !sameJson(before, o.result)) {
        changes.push({
          featureId: o.featureId,
          type: r.feature.type,
          property: o.property,
          before,
          after: o.result,
        });
      }
    }
    return changes;
  }

  /** A feature loaded from the facts has no derived values until its geometry is folded: derive them before recomputing edges. */
  private withDerived(f: FoldedFeature, schema: FoldSchema): FoldedFeature {
    const props = schema.types.get(f.type)?.geometryProperties ?? [];
    const derived = { ...f.derived };
    for (const p of props) {
      const g = f.properties[p];
      if (derived[p] === undefined && isGeometry(g)) derived[p] = this.ports.geo.derive(g);
    }
    return { ...f, derived };
  }

  private evalPair(path: string, self: FoldedFeature, other: FoldedFeature): boolean {
    const typed = this.config.expressions.get(path)?.typed;
    if (typed === undefined) return false;
    const ctx: EvalContext = {
      vars: new Map([
        ['self', { $feature: self.id }],
        ['other', { $feature: other.id }],
      ]),
      features: featureAccess(this, this.config),
      now: this.ports.clock.now(),
      relations: this.config.relations,
      geo: this.ports.geo,
    };
    return condition(typed, ctx).value;
  }

  /** The edges `runId` changed for good: added ones were absent before it, removed ones were present. */
  edgeDelta(runId: RunId): { readonly added: readonly Edge[]; readonly removed: readonly Edge[] } {
    const log = this.edgeLog.get(runId);
    return { added: [...(log?.added.values() ?? [])], removed: [...(log?.removed.values() ?? [])] };
  }

  private has(e: Edge): boolean {
    const key = edgeKey(e);
    if (this.put.has(key)) return true;
    if (this.removed.has(key)) return false;
    return this.base.edgesFrom(e.from, e.relation).some((x) => x.to === e.to);
  }

  private edgeChanges(
    runId: RunId,
    c: { readonly put: readonly Edge[]; readonly remove: readonly Edge[] },
  ): void {
    const log = this.edgeLog.get(runId) ?? {
      added: new Map<string, Edge>(),
      removed: new Map<string, Edge>(),
    };
    this.edgeLog.set(runId, log);
    for (const e of c.remove) {
      const key = edgeKey(e);
      if (this.has(e) && !log.added.delete(key)) log.removed.set(key, e);
      this.put.delete(key);
      this.removed.add(key);
    }
    for (const e of c.put) {
      const key = edgeKey(e);
      if (!this.has(e) && !log.removed.delete(key)) log.added.set(key, e);
      this.removed.delete(key);
      this.put.set(key, e);
    }
  }

  /**
   * Derived-edge lookup over every candidate: `Facts.near` for stored features, shadowed by the
   * features this plan changed (judged by their planned state). Stored features get their derived
   * values computed on the way, so a pair is judged as the server's fold judges it.
   */
  private lookup(): DerivedLookup {
    return {
      near: (type, bbox) => {
        const out: FoldedFeature[] = [];
        for (const f of this.near(type, bbox)) out.push(this.features.get(f.id) ?? { ...f, derived: {} });
        return out;
      },
      typesDerivingTo: (type) =>
        [...this.schema.types].filter(([, t]) => t.derived.some((d) => d.to === type)).map(([k]) => k),
      edgesFrom: (id, relation) => this.edgesFrom(id, relation),
      edgesTo: (id, relation) => this.edgesTo(id, relation),
      condition: (path, self, other) => this.evalPair(path, self, other),
    };
  }
}
