/**
 * Pure planning of one page against the committed in-memory state: which rows to write, which to
 * drop as stale, which tombstones apply. The store then writes the plan in ONE transaction and
 * commits it to memory afterwards. Stale rule: a row with a lower `updatedSeq` never overwrites a
 * newer one; an equal one is an idempotent replay.
 */
import { edgeKey } from '@ueberblick/core/fold';
import type { Edge, FeatureId, FeatureState, RecordedObservation } from '@ueberblick/core/model';
import type { SyncEdge, SyncPerson, SyncRun } from '@ueberblick/core/sync';
import type { PageRows } from './contract';
import type { MemoryIndex } from './memory';

export interface PagePlan {
  readonly featurePuts: readonly FeatureState[];
  readonly featureDeletes: readonly FeatureId[];
  readonly edgePuts: readonly SyncEdge[];
  readonly edgeDeletes: readonly string[];
  readonly historyPuts: readonly RecordedObservation[];
  /** Run rows a kept history row references, and the names of their actors. */
  readonly runPuts: readonly SyncRun[];
  readonly peoplePuts: readonly SyncPerson[];
  /** The whole choosable set when the page carries one (WP-725); it replaces the device's. */
  readonly choosable?: PageRows['choosable'];
  /** Distinct (feature, property) pairs to trim to the history cap. */
  readonly trimPairs: readonly (readonly [FeatureId, string])[];
  readonly staleSkipped: number;
}

const toEdge = (e: SyncEdge): Edge => ({ from: e.from, relation: e.relation, to: e.to, derived: e.derived });

export function toRecorded(o: PageRows['observations'][number]): RecordedObservation {
  // the common row has no times: a plain literal is cheaper than four spreads, one page holds thousands (WP-858)
  if (o.phenomenonTime === null && o.resultTime === null)
    return { featureId: o.featureId, property: o.property, result: o.result, seq: o.seq, runId: o.runId };
  return {
    featureId: o.featureId,
    property: o.property,
    result: o.result,
    seq: o.seq,
    runId: o.runId,
    ...(o.phenomenonTime === null ? {} : { phenomenonTime: o.phenomenonTime }),
    ...(o.resultTime === null ? {} : { resultTime: o.resultTime }),
  };
}

export function planPage(mem: MemoryIndex, rows: PageRows): PagePlan {
  let stale = 0;
  const features = new Map<FeatureId, FeatureState>();
  const edges = new Map<string, SyncEdge>();
  const featureDeletes = new Set<FeatureId>();
  const edgeDeletes = new Set<string>();

  const featureSeq = (id: FeatureId) => features.get(id)?.updatedSeq ?? mem.features.get(id)?.updatedSeq;
  const edgeSeq = (k: string) => edges.get(k)?.updatedSeq ?? mem.edgeSeqOf(k);

  for (const f of rows.features) {
    const seq = featureSeq(f.id);
    if (seq !== undefined && f.updatedSeq < seq) {
      stale++;
      continue;
    }
    features.set(f.id, f);
    featureDeletes.delete(f.id);
  }
  for (const e of rows.edges) {
    const k = edgeKey(e);
    const seq = edgeSeq(k);
    if (seq !== undefined && e.updatedSeq < seq) {
      stale++;
      continue;
    }
    edges.set(k, e);
    edgeDeletes.delete(k);
  }

  const historyPuts = rows.observations.map(toRecorded);
  const droppedHistoryOf = new Set<FeatureId>();

  for (const t of rows.tombstones) {
    if (t.kind === 'edge') {
      const seq = edgeSeq(t.id);
      if (seq !== undefined && seq <= t.seq) {
        edges.delete(t.id);
        if (mem.hasEdge(t.id)) edgeDeletes.add(t.id);
      }
      continue;
    }
    // `redaction` and `blob` tombstones are purges the worker hands to `dropHistory` and `deleteBlob`
    if (t.kind !== 'feature') continue;
    const id = t.id as FeatureId;
    const seq = featureSeq(id);
    if (seq === undefined || seq > t.seq) continue;
    features.delete(id);
    if (mem.features.has(id)) featureDeletes.add(id);
    droppedHistoryOf.add(id);
    const touching = new Set([...mem.edgeKeysOf(id)]);
    for (const [k, e] of edges) if (e.from === id || e.to === id) touching.add(k);
    for (const k of touching) {
      const es = edgeSeq(k);
      if (es !== undefined && es <= t.seq) {
        edges.delete(k);
        if (mem.hasEdge(k)) edgeDeletes.add(k);
      }
    }
  }

  const kept =
    droppedHistoryOf.size === 0 ? historyPuts : historyPuts.filter((o) => !droppedHistoryOf.has(o.featureId));
  // distinct (feature, property) pairs, without building a joined string key per row
  const propsOf = new Map<FeatureId, Set<string>>();
  for (const o of kept) {
    const props = propsOf.get(o.featureId);
    if (props === undefined) propsOf.set(o.featureId, new Set([o.property]));
    else props.add(o.property);
  }
  const trimPairs: (readonly [FeatureId, string])[] = [];
  for (const [id, props] of propsOf) for (const property of props) trimPairs.push([id, property]);

  // a run row is kept only while a history row references it (tombstoned features drop theirs with the page)
  const referenced = new Set<string>(kept.map((o) => o.runId));
  const runPuts = rows.runs.filter((r) => referenced.has(r.id));
  const actors = new Set<string>();
  for (const r of runPuts) if (r.actor !== null) actors.add(r.actor);

  return {
    runPuts,
    peoplePuts: rows.people.filter((p) => actors.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
    ...(rows.choosable === undefined ? {} : { choosable: rows.choosable }),
    featurePuts: [...features.values()],
    // a feature dropped by a tombstone also drops its stored history, even when it was only in this page
    featureDeletes: [...new Set([...featureDeletes, ...droppedHistoryOf])],
    edgePuts: [...edges.values()],
    edgeDeletes: [...edgeDeletes],
    historyPuts: kept,
    trimPairs,
    staleSkipped: stale,
  };
}

/** What `commitPlan` applies to a memory index: the rows of a plan, without the write bookkeeping. A replica gets this over the wire (B-012). */
export type PageEffects = Pick<
  PagePlan,
  | 'featurePuts'
  | 'featureDeletes'
  | 'edgePuts'
  | 'edgeDeletes'
  | 'historyPuts'
  | 'runPuts'
  | 'peoplePuts'
  | 'choosable'
>;

export function commitPlan(mem: MemoryIndex, plan: PageEffects): void {
  for (const id of plan.featureDeletes) mem.deleteFeature(id);
  for (const k of plan.edgeDeletes) mem.deleteEdge(k);
  for (const f of plan.featurePuts) mem.putFeature(f);
  for (const e of plan.edgePuts) mem.putEdge(toEdge(e), e.updatedSeq);
  for (const o of plan.historyPuts) mem.mergeHistory(o);
  mem.activity.putRuns(plan.runPuts);
  mem.activity.putPeople(plan.peoplePuts);
  if (plan.choosable !== undefined) mem.activity.setChoosable(plan.choosable);
}
