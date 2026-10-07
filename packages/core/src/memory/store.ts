/**
 * The in-memory store behind the fake ports: features and edges kept by core.fold exactly as the
 * server and device adapters keep them (F4). It implements `Facts`, so core.plan reads it directly.
 * Server, device and replay checks all use this one class, so "the same log gives the same state"
 * is checked against the real fold, never against a second implementation (R1).
 */
import { condition } from '../expr/evaluate';
import { auditOf, createFold, edgeKey } from '../fold';
import type { DerivedLookup, Fold, FoldedFeature, FoldSchema } from '../fold/contract';
import { bboxIntersects } from '../geo/bbox';
import type { Bbox, Geo } from '../geo/contract';
import type {
  Edge,
  FeatureId,
  FeatureState,
  Json,
  Key,
  Observation,
  RecordedObservation,
  RunId,
  Seq,
} from '../model';
import { featureAccess } from '../plan/access';
import type { Blobs, Clock, Facts } from '../ports';
import type { CompiledConfig } from '../schema/compile/contract';
import { foldSchema } from '../schema/compile/views';
import { isLive, isServed } from '../registry/lifecycle';

/** The state that must match on server and devices. */
export interface Snapshot {
  readonly features: readonly FeatureState[];
  readonly edges: readonly Edge[];
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class MemoryStore implements Facts, Blobs {
  readonly features = new Map<FeatureId, FoldedFeature>();
  readonly edges = new Map<string, Edge>();
  /** Every observation applied, ascending by seq. */
  readonly log: RecordedObservation[] = [];
  private readonly hist = new Map<string, RecordedObservation[]>();
  /** Observations by the actor of the run that wrote them, ascending by seq (only what `append` was told). */
  private readonly byActor = new Map<string, RecordedObservation[]>();
  private headSeq: Seq = 0;
  private readonly fold: Fold;
  /** The fold schema of the config version this store folds under. */
  readonly schema: FoldSchema;

  constructor(
    readonly config: CompiledConfig,
    private readonly clock: Clock,
    private readonly geo: Geo,
    readonly configVersion: number,
  ) {
    this.fold = createFold(geo);
    this.schema = foldSchema(config, configVersion);
  }

  get head(): Seq {
    return this.headSeq;
  }

  feature = (id: FeatureId): FeatureState | undefined => this.features.get(id);
  /** Features of `type` whose geometry bbox (union over its geometry properties, Z ignored) meets `bbox`. */
  near = (type: Key, bbox: Bbox): Iterable<FeatureState> => {
    const props = this.config.foldTypes.get(type)?.geometryProperties ?? [];
    const out: FeatureState[] = [];
    const scratch: [number, number, number, number] = [0, 0, 0, 0]; // one union box, reused per candidate
    for (const f of this.features.values()) {
      if (f.type !== type || !isServed(f.lifecycle)) continue;
      // The fold already stored each geometry property's bbox in `derived`: no recomputation per candidate.
      // Union of the property bboxes without allocating (2k candidates per derived-relation run, docs/12).
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of props) {
        const b = f.derived[p]?.bbox;
        if (b === undefined) continue;
        if (b[0] < x0) x0 = b[0];
        if (b[1] < y0) y0 = b[1];
        if (b[2] > x1) x1 = b[2];
        if (b[3] > y1) y1 = b[3];
      }
      if (x0 > x1) continue; // no geometry property has a bbox
      scratch[0] = x0;
      scratch[1] = y0;
      scratch[2] = x1;
      scratch[3] = y1;
      if (bboxIntersects(scratch, bbox)) out.push(f);
    }
    return out;
  };
  /**
   * Edges leaving `id`. The SQL relation rule (expr/sql/values.ts): the far end must exist and be live, so an
   * edge to a never-created or deleted feature is skipped. One Map lookup per candidate edge.
   */
  edgesFrom = (id: FeatureId, relation?: Key): readonly Edge[] =>
    this.rawEdgesFrom(id, relation).filter((e) => isLive(this.features.get(e.to)));
  /** Edges arriving at `id`, under the same rule: the far end (`from`) must exist and be live. */
  edgesTo = (id: FeatureId, relation?: Key): readonly Edge[] =>
    this.rawEdgesTo(id, relation).filter((e) => isLive(this.features.get(e.from)));
  /** Every stored edge, including to missing or deleted features: derived-edge upkeep must see them to remove them. */
  private rawEdgesFrom = (id: FeatureId, relation?: Key): readonly Edge[] =>
    [...this.edges.values()].filter(
      (e) => e.from === id && (relation === undefined || e.relation === relation),
    );
  private rawEdgesTo = (id: FeatureId, relation?: Key): readonly Edge[] =>
    [...this.edges.values()].filter(
      (e) => e.to === id && (relation === undefined || e.relation === relation),
    );
  history = (id: FeatureId, property: string, limit: number): readonly RecordedObservation[] =>
    limit <= 0 ? [] : (this.hist.get(`${id}\u0000${property}`) ?? []).slice(-limit).reverse();
  observationsByActor = (actorId: string): readonly RecordedObservation[] => this.byActor.get(actorId) ?? [];
  createdBy = (actorId: string, limit: number): number => {
    let n = 0;
    for (const f of this.features.values()) {
      if (n >= limit) break;
      if (f.createdBy === actorId && f.lifecycle !== 'deleted') n++;
    }
    return n;
  };
  featuresWith = (type: Key, property: string, value: Json): Iterable<FeatureState> => {
    const wanted = JSON.stringify(value);
    return [...this.features.values()]
      .filter(
        (f) => f.type === type && isServed(f.lifecycle) && JSON.stringify(f.properties[property]) === wanted,
      )
      .sort(byId);
  };
  ofType = (type: Key): Iterable<FeatureState> =>
    [...this.features.values()].filter((f) => f.type === type && isServed(f.lifecycle)).sort(byId);
  has = (): boolean => false;

  /** Live features of a type, in id order. */
  ids(type: Key | string): FeatureId[] {
    return [...this.features.values()]
      .filter((f) => f.type === type && isServed(f.lifecycle))
      .sort(byId)
      .map((f) => f.id);
  }

  /** Give observations the next seqs and apply them: what the server does for an accepted run. */
  append(
    runId: RunId,
    observations: readonly Observation[],
    actorId?: string,
  ): { firstSeq: Seq; lastSeq: Seq } {
    const firstSeq = this.headSeq + 1;
    const recorded = observations.map((o, i) => ({ ...o, seq: firstSeq + i, runId }));
    this.applyRecorded(recorded);
    if (actorId !== undefined) this.byActor.set(actorId, [...(this.byActor.get(actorId) ?? []), ...recorded]);
    return { firstSeq, lastSeq: this.headSeq };
  }

  /** Apply observations ascending by seq (a pull page, or a replay). Already-seen seqs are ignored. */
  applyRecorded(observations: readonly RecordedObservation[]): void {
    const fresh = observations.filter((o) => o.seq > this.headSeq);
    const schema = this.schema;
    const groups = new Map<FeatureId, RecordedObservation[]>();
    for (const o of fresh) {
      const g = groups.get(o.featureId);
      if (g) g.push(o);
      else groups.set(o.featureId, [o]);
      this.log.push(o);
      const k = `${o.featureId}\u0000${o.property}`;
      const h = this.hist.get(k);
      if (h) h.push(o);
      else this.hist.set(k, [o]);
      this.headSeq = o.seq;
    }
    for (const [id, obs] of groups) {
      const r = this.fold.feature(this.features.get(id), obs, schema);
      if (r.feature === undefined) continue;
      this.features.set(id, r.feature);
      for (const e of r.edges.remove) this.edges.delete(edgeKey(e));
      for (const e of r.edges.put) this.edges.set(edgeKey(e), e);
      if (r.geometryChanged.length > 0 || r.derivedInputsChanged.length > 0) {
        const d = this.fold.recomputeDerived(r.feature, this.lookup(), schema);
        for (const e of d.remove) this.edges.delete(edgeKey(e));
        for (const e of d.put) this.edges.set(edgeKey(e), e);
      }
    }
  }

  /**
   * The in-place blanking of a server erasure (B-005): the stored result of every observation of these pairs becomes
   * null, in the log, the history and the actor index. seq and run stay; the folded state is untouched (a null
   * observation is already current). The one exception to append-only, mirrored from the SQLite executor.
   */
  purge(pairs: readonly { readonly featureId: FeatureId; readonly property: string }[]): void {
    const doomed = new Set(pairs.map((p) => `${p.featureId}\u0000${p.property}`));
    const blank = (list: RecordedObservation[]): void => {
      list.forEach((o, i) => {
        if (doomed.has(`${o.featureId}\u0000${o.property}`)) list[i] = { ...o, result: null };
      });
    };
    blank(this.log);
    for (const list of this.hist.values()) blank(list);
    for (const list of this.byActor.values()) blank(list);
  }

  /** An independent copy: the device's predicted view starts as a clone of what it has confirmed. */
  clone(): MemoryStore {
    const c = new MemoryStore(this.config, this.clock, this.geo, this.configVersion);
    for (const [k, v] of this.features) c.features.set(k, v);
    for (const [k, v] of this.edges) c.edges.set(k, v);
    c.log.push(...this.log);
    for (const [k, v] of this.hist) c.hist.set(k, [...v]);
    for (const [k, v] of this.byActor) c.byActor.set(k, [...v]);
    c.headSeq = this.headSeq;
    return c;
  }

  /** Comparable state: sorted features (no derived caches) and edges. */
  snapshot(): Snapshot {
    return {
      features: [...this.features.values()]
        .map(({ id, type, properties, lifecycle, updatedSeq, pinnedVersion, ...rest }) => ({
          id,
          type,
          properties,
          lifecycle,
          ...auditOf(rest),
          ...(pinnedVersion === undefined ? {} : { pinnedVersion }),
          updatedSeq,
        }))
        .sort(byId),
      edges: [...this.edges.values()].sort((a, b) => (edgeKey(a) < edgeKey(b) ? -1 : 1)),
    };
  }

  private lookup(): DerivedLookup {
    return {
      near: (type, bbox) =>
        [...this.features.values()].filter(
          (f) => f.type === type && Object.values(f.derived).some((d) => bboxIntersects(d.bbox, bbox)),
        ),
      typesDerivingTo: (type) =>
        [...this.config.foldTypes].filter(([, t]) => t.derived.some((d) => d.to === type)).map(([k]) => k),
      edgesFrom: this.rawEdgesFrom,
      edgesTo: this.rawEdgesTo,
      condition: (path, self, other) => {
        const typed = this.config.expressions.get(path)?.typed;
        if (typed === undefined) return false;
        const ctx = {
          vars: new Map([
            ['self', { $feature: self.id }],
            ['other', { $feature: other.id }],
          ]),
          features: featureAccess(this, this.config),
          now: this.clock.now(),
          relations: this.config.relations,
          geo: this.geo,
        };
        return condition(typed, ctx).value;
      },
    };
  }
}
