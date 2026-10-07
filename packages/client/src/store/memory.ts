/**
 * In-memory indexes behind the synchronous `Facts` and `Blobs` ports. They mirror committed
 * IndexedDB state: the store updates them only after a transaction completed.
 */
import type { Edge, FeatureId, FeatureState, Key, RecordedObservation } from '@ueberblick/core/model';
import { edgeKey } from '@ueberblick/core/fold';
import { SYNC_OBSERVATION_HISTORY } from '@ueberblick/core/sync';
import { DeviceStoreError } from './codes';
import type { PlannedChange, Prediction, StoredCursor, StoredRun, TextSource } from './contract';
import { matchesWords, TextIndexes, tokenize } from './text-index';
import { bboxMeets, featureBbox, SpatialIndex } from './spatial';
import type { Bbox } from '@ueberblick/core/geo';
import { isServed } from '@ueberblick/core/registry';
import { ActivityIndex } from './activity-mem';

/** Features whose history stays loaded; older ones are dropped and reload on `warmHistory`. */
export const HISTORY_CACHE_FEATURES = 4000;

const EMPTY: readonly never[] = [];

function addTo(map: Map<string, Set<FeatureId>>, type: string, id: FeatureId): void {
  const s = map.get(type);
  if (s) s.add(id);
  else map.set(type, new Set([id]));
}

function removeFrom(map: Map<string, Set<FeatureId>>, type: string, id: FeatureId): void {
  const s = map.get(type);
  if (!s) return;
  s.delete(id);
  if (s.size === 0) map.delete(type);
}

/** Adjacency: most features have one edge, so a single key is stored inline and a Set only when needed. */
type Adjacent = string | Set<string>;

function adjAdd(map: Map<FeatureId, Adjacent>, id: FeatureId, k: string): void {
  const cur = map.get(id);
  if (cur === undefined) map.set(id, k);
  else if (typeof cur === 'string') {
    if (cur !== k) map.set(id, new Set([cur, k]));
  } else cur.add(k);
}

function adjRemove(map: Map<FeatureId, Adjacent>, id: FeatureId, k: string): void {
  const cur = map.get(id);
  if (cur === undefined) return;
  if (typeof cur === 'string') {
    if (cur === k) map.delete(id);
    return;
  }
  cur.delete(k);
  if (cur.size === 0) map.delete(id);
}

function adjKeys(a: Adjacent | undefined): readonly string[] {
  return a === undefined ? EMPTY : typeof a === 'string' ? [a] : [...a];
}

export class MemoryIndex {
  readonly features = new Map<FeatureId, FeatureState>();
  private readonly byType = new Map<string, Set<FeatureId>>();
  private readonly spatial = new SpatialIndex();
  private readonly text = new TextIndexes(this.features);
  // one map for an edge and its seq: every map that grows with the feature count rehashes on the page that crosses 2^15 (WP-858)
  private readonly edgeRows = new Map<string, { readonly edge: Edge; readonly seq: number }>();
  private readonly out = new Map<FeatureId, Adjacent>();
  private readonly into = new Map<FeatureId, Adjacent>();
  readonly blobKeys = new Set<string>();
  cursor: StoredCursor | undefined;
  readonly activity = new ActivityIndex();

  private readonly predictions = new Map<string, Prediction>();
  private overlayFeatures = new Map<FeatureId, FeatureState>();
  private overlayOut = new Map<FeatureId, Edge[]>();
  private overlayIn = new Map<FeatureId, Edge[]>();

  private readonly history = new Map<FeatureId, Map<string, RecordedObservation[]>>();

  // -- features and edges (committed state)

  putFeature(f: FeatureState): void {
    const prev = this.features.get(f.id);
    if (prev && prev.type !== f.type) removeFrom(this.byType, prev.type, f.id);
    this.text.update(prev, f);
    this.features.set(f.id, f);
    addTo(this.byType, f.type, f.id);
    this.spatial.put(f);
  }

  deleteFeature(id: FeatureId): void {
    const prev = this.features.get(id);
    if (!prev) return;
    removeFrom(this.byType, prev.type, id);
    this.text.update(prev, undefined);
    this.features.delete(id);
    this.spatial.delete(id);
    this.history.delete(id);
  }

  putEdge(e: Edge, seq: number): void {
    const k = edgeKey(e);
    this.edgeRows.set(k, { edge: e, seq });
    adjAdd(this.out, e.from, k);
    adjAdd(this.into, e.to, k);
  }

  deleteEdge(k: string): void {
    const e = this.edgeRows.get(k)?.edge;
    if (!e) return;
    this.edgeRows.delete(k);
    adjRemove(this.out, e.from, k);
    adjRemove(this.into, e.to, k);
  }

  hasEdge(k: string): boolean {
    return this.edgeRows.has(k);
  }

  /** The `updatedSeq` the committed edge carries, undefined when there is none. */
  edgeSeqOf(k: string): number | undefined {
    return this.edgeRows.get(k)?.seq;
  }

  /** Edge keys touching a feature, from either side. */
  edgeKeysOf(id: FeatureId): string[] {
    return [...adjKeys(this.out.get(id)), ...adjKeys(this.into.get(id))];
  }

  idsOfType(type: string): FeatureId[] {
    return [...(this.byType.get(type) ?? EMPTY)];
  }

  clearCache(): void {
    this.features.clear();
    this.byType.clear();
    this.spatial.clear();
    this.text.clear();
    this.edgeRows.clear();
    this.out.clear();
    this.into.clear();
    this.history.clear();
    this.activity.clearSynced();
    this.cursor = undefined;
  }

  // -- predictions (overlay)

  setPrediction(p: Prediction): void {
    this.predictions.delete(p.runId);
    this.predictions.set(p.runId, p);
    this.rebuildOverlay();
  }

  removePrediction(runId: string): void {
    if (this.predictions.delete(runId)) this.rebuildOverlay();
  }

  private rebuildOverlay(): void {
    this.overlayFeatures = new Map();
    this.overlayOut = new Map();
    this.overlayIn = new Map();
    for (const p of this.predictions.values()) {
      for (const f of p.features) this.overlayFeatures.set(f.id, f);
      for (const e of p.edges) {
        (this.overlayOut.get(e.from) ?? this.overlayOut.set(e.from, []).get(e.from))?.push(e);
        (this.overlayIn.get(e.to) ?? this.overlayIn.set(e.to, []).get(e.to))?.push(e);
      }
    }
  }

  // -- Facts

  feature(id: FeatureId): FeatureState | undefined {
    return this.overlayFeatures.get(id) ?? this.features.get(id);
  }

  near(type: Key, bbox: Bbox): Iterable<FeatureState> {
    const out: FeatureState[] = [];
    for (const id of this.spatial.query(type, bbox)) {
      if (this.overlayFeatures.has(id)) continue; // a prediction supersedes it, below
      const f = this.features.get(id);
      if (f) out.push(f);
    }
    for (const f of this.overlayFeatures.values()) {
      if (f.type !== type || !isServed(f.lifecycle)) continue;
      const b = featureBbox(f);
      if (b && bboxMeets(b, bbox)) out.push(f);
    }
    return out;
  }

  /** Lazy: walks the type's index without copying it. A caller that needs an array takes one (`Array.from`). */
  *ofType(type: Key): Generator<FeatureState, void, undefined> {
    const overlay = this.overlayFeatures;
    for (const id of this.byType.get(type) ?? EMPTY) {
      if (overlay.has(id)) continue; // a prediction supersedes it, below
      const f = this.features.get(id);
      if (f && isServed(f.lifecycle)) yield f;
    }
    for (const f of overlay.values()) if (f.type === type && isServed(f.lifecycle)) yield f;
  }

  /** Registers a searchable property (idempotent) and bulk-builds it from the features held. */
  indexText(type: Key, property: string): void {
    this.text.register(type, property);
  }

  /**
   * Ids whose searched values hold every word of `query` as a prefix (case and diacritics folded), at most
   * `limit`. An unregistered source throws `text_source_not_indexed`. Predicted features supersede committed ones and
   * are scanned directly (a queue holds few).
   */
  searchText(sources: readonly TextSource[], query: string, limit: number): FeatureId[] {
    for (const s of sources)
      if (!this.text.has(s))
        throw new DeviceStoreError(
          'text_source_not_indexed',
          `Text source ${s.type}.${s.property} is not indexed; call indexText first.`,
        );
    const words = tokenize(query);
    if (words.length === 0 || limit <= 0) return [];
    const out = this.text.search(sources, words, limit, (id) => this.overlayFeatures.has(id));
    for (const f of this.overlayFeatures.values()) {
      if (out.length >= limit) break;
      if (isServed(f.lifecycle) && matchesWords(f, sources, words)) out.push(f.id);
    }
    return out;
  }

  edgesFrom(id: FeatureId, relation?: Key): readonly Edge[] {
    return this.collect(this.out.get(id), this.overlayOut.get(id), relation);
  }

  edgesTo(id: FeatureId, relation?: Key): readonly Edge[] {
    return this.collect(this.into.get(id), this.overlayIn.get(id), relation);
  }

  private collect(
    keys: Adjacent | undefined,
    overlay: Edge[] | undefined,
    relation: Key | undefined,
  ): Edge[] {
    if (overlay === undefined || overlay.length === 0) {
      // the common read (no queued run touches this feature): committed edges only, no dedupe map (WP-845)
      if (keys === undefined) return [];
      const one = (k: string): Edge | undefined => {
        const e = this.edgeRows.get(k)?.edge;
        return e && (!relation || e.relation === relation) ? e : undefined;
      };
      if (typeof keys === 'string') {
        const e = one(keys);
        return e === undefined ? [] : [e];
      }
      const out: Edge[] = [];
      for (const k of keys) {
        const e = one(k);
        if (e !== undefined) out.push(e);
      }
      return out;
    }
    const seen = new Map<string, Edge>();
    for (const k of adjKeys(keys)) {
      const e = this.edgeRows.get(k)?.edge;
      if (e && (!relation || e.relation === relation)) seen.set(k, e);
    }
    for (const e of overlay ?? EMPTY) if (!relation || e.relation === relation) seen.set(edgeKey(e), e);
    return [...seen.values()];
  }

  // -- history cache

  isWarm(id: FeatureId): boolean {
    return this.history.has(id);
  }

  setHistory(id: FeatureId, rows: readonly RecordedObservation[]): void {
    const byProperty = new Map<string, RecordedObservation[]>();
    for (const r of rows)
      (byProperty.get(r.property) ?? byProperty.set(r.property, []).get(r.property))?.push(r);
    for (const list of byProperty.values()) list.sort((a, b) => b.seq - a.seq);
    this.history.delete(id);
    this.history.set(id, byProperty);
    while (this.history.size > HISTORY_CACHE_FEATURES) {
      const oldest = this.history.keys().next();
      if (oldest.done) break;
      this.history.delete(oldest.value);
    }
  }

  /** Merge committed observations into the history of an already warm feature. */
  mergeHistory(o: RecordedObservation): void {
    const byProperty = this.history.get(o.featureId);
    if (!byProperty) return;
    const list = (byProperty.get(o.property) ?? []).filter((x) => x.seq !== o.seq);
    list.push(o);
    list.sort((a, b) => b.seq - a.seq);
    byProperty.set(o.property, list.slice(0, SYNC_OBSERVATION_HISTORY));
  }

  dropHistoryOf(id: FeatureId, properties: readonly string[]): void {
    const byProperty = this.history.get(id);
    if (byProperty) for (const p of properties) byProperty.delete(p);
  }

  /** Every warm observation of a feature, newest seq first. */
  observationsOf(id: FeatureId): readonly RecordedObservation[] {
    const byProperty = this.history.get(id);
    if (!byProperty)
      throw new DeviceStoreError(
        'history_not_warm',
        `History of ${id} is not loaded; call warmActivity first.`,
      );
    return [...byProperty.values()].flat().sort((a, b) => b.seq - a.seq);
  }

  plannedChangesOf(runId: string, id: FeatureId): readonly PlannedChange[] {
    return (this.predictions.get(runId)?.observations ?? []).filter((o) => o.featureId === id);
  }

  /** Queued runs (and predictions) of a feature. */
  queuedOf(id: FeatureId): readonly StoredRun[] {
    return this.activity.queuedOf(id, this.predictions.values());
  }

  historyOf(id: FeatureId, property: string, limit: number): readonly RecordedObservation[] {
    const byProperty = this.history.get(id);
    if (!byProperty)
      throw new DeviceStoreError(
        'history_not_warm',
        `History of ${id} is not loaded; call warmHistory first.`,
      );
    this.history.delete(id);
    this.history.set(id, byProperty); // most recently used
    return (byProperty.get(property) ?? EMPTY).slice(0, limit);
  }
}
