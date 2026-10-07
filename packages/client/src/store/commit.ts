/**
 * A committed change of the cache, as the writer (the store that owns the IndexedDB writes) reports it and a
 * read replica applies it (B-012). The page commit is the applied `PagePlan`, so the replica runs the same
 * `commitPlan` and there is no second implementation of the plan logic (R1). Pure data: it is what travels
 * between threads.
 */
import type { FeatureId } from '@ueberblick/core/model';
import type { StoredCursor, StoreChange } from './contract';
import type { PageEffects } from './plan';

/** The commit kinds; `StoreChange` adds `reloaded`, which only a replica raises for itself. */
export const COMMIT_KINDS = ['page', 'cleared', 'history_dropped', 'blob_purge'] as const;

export type StoreCommit =
  | { readonly kind: 'page'; readonly plan: PageEffects; readonly cursor: StoredCursor }
  | { readonly kind: 'cleared' }
  | {
      readonly kind: 'history_dropped';
      readonly featureId: FeatureId;
      readonly properties: readonly string[];
    }
  /** The writer's announcement of blob tombstones; the main thread applies them on its own connection (`blobs` is queue data). */
  | { readonly kind: 'blob_purge'; readonly ids: readonly string[] };

/** A commit with the cursor the copy was at before it: a replica applies it only from that cursor. */
export interface CommitNotice {
  readonly from: StoredCursor | undefined;
  readonly commit: StoreCommit;
  /**
   * A page too big for one main-thread task travels as `count` notices (`index` 0-based, in order); only the
   * first carries the `from` check, and the cursor and the change notification come with the last.
   */
  readonly part?: { readonly index: number; readonly count: number };
}

/** Rows one slice of a page carries, at most (about 10 ms of main-thread work at the x4 device factor). */
export const SLICE_ROWS = 600;

type Plan = PageEffects;

/** Every row that belongs to one feature: the feature itself, the edges from it and its history. */
interface Group {
  featurePuts: Plan['featurePuts'][number][];
  featureDeletes: FeatureId[];
  edgePuts: Plan['edgePuts'][number][];
  edgeDeletes: string[];
  historyPuts: Plan['historyPuts'][number][];
  rows: number;
}

/** The feature an edge key (`from`, relation, `to`, NUL-separated) starts at. */
const fromOfKey = (k: string): FeatureId => k.slice(0, k.indexOf('\u0000')) as FeatureId;

function groupsOf(p: Plan): readonly Group[] {
  const groups = new Map<FeatureId, Group>();
  const of = (id: FeatureId): Group => {
    const g = groups.get(id);
    if (g) return g;
    const fresh: Group = {
      featurePuts: [],
      featureDeletes: [],
      edgePuts: [],
      edgeDeletes: [],
      historyPuts: [],
      rows: 0,
    };
    groups.set(id, fresh);
    return fresh;
  };
  for (const f of p.featurePuts) of(f.id).featurePuts.push(f);
  for (const id of p.featureDeletes) of(id).featureDeletes.push(id);
  for (const e of p.edgePuts) of(e.from).edgePuts.push(e);
  for (const k of p.edgeDeletes) of(fromOfKey(k)).edgeDeletes.push(k);
  for (const h of p.historyPuts) of(h.featureId).historyPuts.push(h);
  for (const g of groups.values())
    g.rows =
      g.featurePuts.length +
      g.featureDeletes.length +
      g.edgePuts.length +
      g.edgeDeletes.length +
      g.historyPuts.length;
  return [...groups.values()];
}

/**
 * Splits a page notice into slices of about `SLICE_ROWS` rows so the replica applies each in its own task
 * (R14: a 1,000-feature page in one task was measured at 50-110 ms at x4). A slice holds whole feature groups:
 * a feature travels with the edges from it and its history rows, so a reader between two slices never sees a
 * feature without them. An oversized single group is one slice; a group is never split. Other commits stay
 * whole. Only the rows a replica applies are kept.
 *
 * Caveat: only the edges FROM a feature travel with it, so between slices an edge may dangle (its `to` feature
 * is in a later slice) and `edgesTo(x)` lacks edges whose source group has not arrived. Readers tolerate a
 * missing endpoint while `pageInFlight()` is true; the run queue re-predicts through `rederive` after the whole pull, so it never sees a half page.
 */
export function sliceNotice(notice: CommitNotice, rows: number = SLICE_ROWS): readonly CommitNotice[] {
  const c = notice.commit;
  if (c.kind !== 'page') return [notice];
  const slices: Group[][] = [];
  let size = 0;
  for (const g of groupsOf(c.plan)) {
    const last = slices.at(-1);
    if (last && size + g.rows <= rows) {
      last.push(g);
      size += g.rows;
    } else {
      slices.push([g]);
      size = g.rows;
    }
  }
  if (slices.length === 0) slices.push([]);
  const count = slices.length;
  return slices.map((gs, index) => ({
    from: notice.from,
    ...(count > 1 ? { part: { index, count } } : {}),
    commit: {
      kind: 'page',
      cursor: c.cursor,
      plan: {
        featurePuts: gs.flatMap((g) => g.featurePuts),
        featureDeletes: gs.flatMap((g) => g.featureDeletes),
        edgePuts: gs.flatMap((g) => g.edgePuts),
        edgeDeletes: gs.flatMap((g) => g.edgeDeletes),
        historyPuts: gs.flatMap((g) => g.historyPuts),
        // run rows and names belong to no feature: they travel with the first slice, before any history row
        runPuts: index === 0 ? c.plan.runPuts : [],
        peoplePuts: index === 0 ? c.plan.peoplePuts : [],
        ...(index === 0 && c.plan.choosable !== undefined ? { choosable: c.plan.choosable } : {}),
      },
    },
  }));
}

export const sameCursor = (a: StoredCursor | undefined, b: StoredCursor | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.kind === b.kind &&
    a.cursor === b.cursor &&
    a.scopeFingerprint === b.scopeFingerprint);

/** The public view of a commit: what subscribers of `DeviceStore.onChange` get. A `blob_purge` is heard as `blob_deleted` once applied. */
export function toChange(commit: Exclude<StoreCommit, { kind: 'blob_purge' }>): StoreChange {
  if (commit.kind !== 'page') return commit;
  const ids = new Set<FeatureId>();
  for (const f of commit.plan.featurePuts) ids.add(f.id);
  for (const id of commit.plan.featureDeletes) ids.add(id);
  return { kind: 'page', featureIds: [...ids], cursor: commit.cursor };
}
