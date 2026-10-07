import Supercluster from 'supercluster';
import type { Bbox } from '@ueberblick/core/geo';
import type { Json } from '@ueberblick/core/model';
import { feedOf, HeldPoint, type Props } from './feed';
import type { CappedStats, ClusterItem, ClusterPoint, ToWorker, FromWorker } from './protocol';

/** v3's `CLUSTER_RADIUS` (`MapCanvas.svelte:197`), in px. */
export const CLUSTER_RADIUS = 80;
/** v3's `getGlobalMaxZoom()` when the project sets no `max_zoom` (`MapCanvas.svelte:304-311`). */
export const DEFAULT_MAX_ZOOM = 19;
/** Rebuild once this many changes are pending (or 0.5 % of the points, if more). */
const MIN_REBUILD_CHANGES = 200;
const REBUILD_FRACTION = 0.005;
const MAX_GONE = 100_000;
/** The counts key of a feature whose classifying property holds no string (WP-674). */
export const UNSET = '_unset';

type Counts = { [value: string]: number };

/** A count lives under this prefix in a cluster's properties: Supercluster clones them shallowly, so they stay flat. */
const COUNT = '#';

/** Supercluster's `map` and `reduce` for per-value counts: one small flat object per point at a build, merged up the zoom levels. */
const countsBy = (key: string) => ({
  map: (p: unknown): Counts => {
    const v = (p as HeldPoint).props?.[key];
    return { [COUNT + (typeof v === 'string' ? v : UNSET)]: 1 };
  },
  reduce: (acc: Counts, p: Counts): void => {
    for (const k in p) acc[k] = (acc[k] ?? 0) + (p[k] as number);
  },
});

/** The per-value counts of a cluster's properties, or none when it has any. */
function countsOf(props: { readonly [key: string]: unknown }): Counts | undefined {
  let out: Counts | undefined;
  for (const k in props) {
    if (!k.startsWith(COUNT)) continue;
    out ??= {};
    out[k.slice(1)] = props[k] as number;
  }
  return out;
}

/**
 * The worker's state: held points by id (made once per delta, not once per index build) and a
 * Supercluster index built lazily. Supercluster cannot change a built index, so changes after a
 * build wait in `pending` and are overlaid on the query result: exact for single features, while
 * counts inside clusters may lag by up to the bound (max of 200 and 0.5 % of the points). Once more
 * than that has piled up, the next query rebuilds from all points.
 */
export class ClusterIndex {
  private readonly points = new Map<string, HeldPoint>();
  /** Ids removed lately: their re-add is a batch-like change (bounded). */
  private readonly gone = new Set<string>();
  private readonly pending = new Map<string, HeldPoint | undefined>();
  private keys: readonly string[] = [];
  private classifyKey: string | undefined;
  private index: Supercluster | undefined;
  private buildCount = 0;
  private maxZoom = DEFAULT_MAX_ZOOM;

  get size(): number {
    return this.points.size;
  }

  /** How often the whole index was built (tests, benchmarks). */
  get builds(): number {
    return this.buildCount;
  }

  apply(add: readonly ClusterPoint[], update: readonly ClusterPoint[], remove: readonly string[]): void {
    // A batch of additions (a filter switch on, a sync page) or a re-add of a removed id would sit beside its cluster as
    // a single (WP-706): rebuild once. One new realtime point keeps the pending overlay.
    if (this.index !== undefined && (add.length > 1 || add.some((p) => this.gone.has(p.id))))
      this.invalidate();
    for (const p of add) {
      this.gone.delete(p.id);
      this.set(p.id, this.toPoint(p));
    }
    for (const p of update) this.set(p.id, this.toPoint(p));
    for (const id of remove)
      if (this.points.delete(id)) {
        this.invalidate();
        if (this.gone.size >= MAX_GONE) this.gone.clear();
        this.gone.add(id);
      }
  }

  /**
   * A removal cannot be overlaid on a built cluster: its count and members would stay wrong (WP-706). So the built index
   * goes and is rebuilt at the next query, in the worker: once per delta, not once per point.
   */
  private invalidate(): void {
    this.index = undefined;
    this.pending.clear();
  }

  /** The project's max zoom (v3 `getGlobalMaxZoom`); `undefined` is v3's default of 19. A change rebuilds the index at the next query. */
  setMaxZoom(maxZoom: number | undefined): void {
    const next = maxZoom ?? DEFAULT_MAX_ZOOM;
    if (next === this.maxZoom) return;
    this.maxZoom = next;
    this.index = undefined;
    this.pending.clear();
  }

  private set(id: string, feature: HeldPoint): void {
    const before = this.points.get(id);
    this.points.set(id, feature);
    if (before !== undefined && (before.lng !== feature.lng || before.lat !== feature.lat)) {
      this.invalidate(); // a moved member leaves its built cluster
      return;
    }
    this.note(id, feature);
  }

  private note(id: string, feature: HeldPoint | undefined): void {
    if (this.index !== undefined) this.pending.set(id, feature);
  }

  private toPoint(p: ClusterPoint): HeldPoint {
    return new HeldPoint(p.id, p.lng, p.lat, p.props === undefined ? undefined : { ...p.props });
  }

  /** Sets the used keys: drops the others, merges `values` (new keys) into held points. */
  setKeys(
    keys: readonly string[],
    values: readonly { id: string; props: { readonly [key: string]: Json } }[],
  ): void {
    this.keys = keys;
    for (const f of this.points.values()) if (f.props !== undefined) f.props = this.pick(f.props);
    this.addValues(values);
  }

  /**
   * The classifying property (WP-674, B-018): a cluster then carries `counts`, how many of its features hold each value
   * (the key must be one of `keys`). `undefined` turns the counts off. A change rebuilds the index at the next query.
   */
  setClassify(key: string | undefined): void {
    if (key === this.classifyKey) return;
    this.classifyKey = key;
    this.index = undefined;
    this.pending.clear();
  }

  /** Merges values for the current keys into held points (ids not held are ignored). */
  addValues(values: readonly { id: string; props: { readonly [key: string]: Json } }[]): void {
    for (const v of values) {
      const f = this.points.get(v.id);
      if (f !== undefined) f.props = this.pick({ ...f.props, ...v.props });
    }
    this.index = undefined;
    this.pending.clear();
  }

  private pick(props: { readonly [key: string]: Json }): Props {
    const out: Props = {};
    for (const k of this.keys) if (props[k] !== undefined) out[k] = props[k];
    return out;
  }

  private stale(): boolean {
    return this.pending.size > Math.max(MIN_REBUILD_CHANGES, this.points.size * REBUILD_FRACTION);
  }

  private built(): Supercluster {
    if (this.index === undefined || this.stale()) {
      const by = this.classifyKey;
      const index = new Supercluster({
        radius: CLUSTER_RADIUS,
        maxZoom: this.maxZoom,
        ...(by === undefined ? {} : countsBy(by)),
      }) as unknown as Supercluster;
      index.load(feedOf([...this.points.values()]));
      this.index = index;
      this.pending.clear();
      this.buildCount++;
    }
    return this.index;
  }

  query(bbox: Bbox, zoom: number): ClusterItem[] {
    const clusters = this.built().getClusters([...bbox], Math.min(Math.round(zoom), this.maxZoom + 1));
    const items: ClusterItem[] = [];
    for (const f of clusters) {
      const [lng = 0, lat = 0] = f.geometry.coordinates;
      const props = f.properties as {
        cluster?: boolean;
        cluster_id?: number;
        point_count?: number;
        featureId?: string;
        props?: Props;
      };
      if (props.cluster === true && props.cluster_id !== undefined && props.point_count !== undefined) {
        const counts = countsOf(props);
        items.push({
          lng,
          lat,
          clusterId: props.cluster_id,
          count: props.point_count,
          ...(counts === undefined ? {} : { counts }),
        });
        continue;
      }
      if (this.pending.has(props.featureId ?? '')) continue; // changed since the build: shown from the overlay
      items.push(this.single(lng, lat, props.featureId ?? '', props.props));
    }
    for (const f of this.pending.values()) {
      if (f === undefined) continue;
      const { lng, lat } = f;
      if (lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]) {
        items.push(this.single(lng, lat, f.featureId, f.props));
      }
    }
    return items;
  }

  /**
   * v3's two-phase query (`MapCanvas.svelte:786-796`): the clustered answer at `zoom` counts the features in view
   * in O(clusters in view); only when that total fits `cap` is the index asked again above its max zoom, which
   * returns the (at most `cap`) features singly. Never a pass over all points.
   */
  queryCapped(bbox: Bbox, zoom: number, cap: number): CappedStats & { items: ClusterItem[] } {
    const items = this.query(bbox, zoom);
    let inView = 0;
    for (const i of items) inView += i.count ?? 1;
    if (inView === 0 || inView > cap) return { items, inView, single: false };
    const singles = this.query(bbox, this.maxZoom + 1); // exact: cluster counts may lag the pending changes
    return { items: singles, inView: singles.length, single: true };
  }

  private single(lng: number, lat: number, featureId: string, props: Props | undefined): ClusterItem {
    const single = { lng, lat, featureId };
    return props === undefined || this.keys.length === 0
      ? single
      : { ...single, properties: this.pick(props) };
  }

  /** The held features of these ids, as singles (unknown ids are left out). Costs the number of ids. */
  byIds(ids: readonly string[]): ClusterItem[] {
    const items: ClusterItem[] = [];
    for (const id of ids) {
      const f = this.points.get(id);
      if (f !== undefined) items.push(this.single(f.lng, f.lat, f.featureId, f.props));
    }
    return items;
  }

  /** The members of a cluster, as singles. Costs the size of the cluster, not of the index. */
  leaves(clusterId: number): ClusterItem[] {
    return this.built()
      .getLeaves(clusterId, Infinity)
      .map((f) => {
        const [lng = 0, lat = 0] = f.geometry.coordinates;
        const p = f.properties as { featureId?: string; props?: Props };
        return this.single(lng, lat, p.featureId ?? '', p.props);
      });
  }
}

/** The worker's message handler, free of `self`, so it runs in a test or a benchmark unchanged. */
export function createClusterHandler(reply: (message: FromWorker) => void): (message: ToWorker) => void {
  const index = new ClusterIndex();
  return (message) => {
    if (message.type === 'apply') index.apply(message.add, message.update, message.remove);
    else if (message.type === 'keys') index.setKeys(message.keys, message.values);
    else if (message.type === 'values') index.addValues(message.values);
    else if (message.type === 'classify') index.setClassify(message.key);
    else if (message.type === 'maxZoom') index.setMaxZoom(message.maxZoom);
    else if (message.type === 'query') {
      if (message.cap === undefined)
        reply({ type: 'clusters', reqId: message.reqId, items: index.query(message.bbox, message.zoom) });
      else {
        const { items, ...stats } = index.queryCapped(message.bbox, message.zoom, message.cap);
        reply({ type: 'clusters', reqId: message.reqId, items, stats });
      }
    } else if (message.type === 'leaves') {
      reply({ type: 'leaves', reqId: message.reqId, items: index.leaves(message.clusterId) });
    } else if (message.type === 'byIds') {
      reply({ type: 'byIds', reqId: message.reqId, items: index.byIds(message.ids) });
    }
  };
}
