import type { Bbox } from '@ueberblick/core/geo';
import type { Json } from '@ueberblick/core/model';
import { CHUNK_SIZE, yieldToMain, type YieldToMain } from '../maplibre/chunk';
import type { FeatureChange, MapFeature } from '../contract';
import { createClusterHandler } from './index-core';
import type {
  CappedStats,
  ClusterItem,
  ClusterPoint,
  ClusterTransport,
  FromWorker,
  ToWorker,
} from './protocol';

/** A real Web Worker transport. */
export function createWorkerTransport(): ClusterTransport {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (m) => worker.postMessage(m),
    onMessage: (listener) => {
      worker.onmessage = (e: MessageEvent<FromWorker>) => listener(e.data);
    },
    close: () => worker.terminate(),
  };
}

/** Runs the worker's handler in this thread: for tests and benchmarks only. */
export function createInProcessTransport(): ClusterTransport {
  let listener: ((m: FromWorker) => void) | undefined;
  const handle = createClusterHandler((m) => listener?.(m));
  return {
    post: (m) => handle(m),
    onMessage: (l) => {
      listener = l;
    },
    close: () => {
      listener = undefined;
    },
  };
}

/** The worker's answer to a query: the items, and with a cap the stats. */
export interface ClusterAnswer {
  readonly items: readonly ClusterItem[];
  readonly stats?: CappedStats;
}

/** Main-thread side: turns feature changes into deltas and requests clusters for a viewport. */
export class ClusterClient {
  private nextReq = 1;
  private keys: readonly string[] = [];
  private readonly clusterWaiters = new Map<number, (answer: ClusterAnswer) => void>();
  private readonly leavesWaiters = new Map<number, (items: readonly ClusterItem[]) => void>();
  private readonly byIdsWaiters = new Map<number, (items: readonly ClusterItem[]) => void>();

  /** Set while values for a new key are still being delivered in chunks; later posts queue behind it. */
  private tail: Promise<void> | undefined;

  constructor(
    private readonly transport: ClusterTransport,
    private readonly yieldNow: YieldToMain = yieldToMain,
    private readonly chunkSize: number = CHUNK_SIZE,
  ) {
    transport.onMessage((m) => {
      if (m.type === 'clusters') {
        this.clusterWaiters.get(m.reqId)?.({
          items: m.items,
          ...(m.stats === undefined ? {} : { stats: m.stats }),
        });
        this.clusterWaiters.delete(m.reqId);
      } else if (m.type === 'leaves') {
        this.leavesWaiters.get(m.reqId)?.(m.items);
        this.leavesWaiters.delete(m.reqId);
      } else {
        this.byIdsWaiters.get(m.reqId)?.(m.items);
        this.byIdsWaiters.delete(m.reqId);
      }
    });
  }

  /** Sends only the changed anchors and ids. */
  apply(change: FeatureChange): void {
    const keys = this.keys;
    const point = (f: MapFeature): ClusterPoint => {
      const base = { id: f.id, lng: f.anchor[0] ?? 0, lat: f.anchor[1] ?? 0 };
      return keys.length === 0 ? base : { ...base, props: pickProps(f, keys) };
    };
    const message: ToWorker = {
      type: 'apply',
      add: change.add.map(point),
      update: change.update.map(point),
      remove: change.remove,
    };
    this.send(() => this.transport.post(message));
  }

  /**
   * Sets the property keys the style uses. Only when a key is new does the worker get values, for
   * that key alone; anchors are never resent. Unchanged keys post nothing. Returns whether the
   * cluster output changed.
   */
  setKeys(keys: readonly string[], features: readonly MapFeature[]): boolean {
    const same = keys.length === this.keys.length && keys.every((k) => this.keys.includes(k));
    if (same) return false;
    const added = keys.filter((k) => !this.keys.includes(k));
    this.keys = keys;
    if (added.length === 0) this.send(() => this.transport.post({ type: 'keys', keys, values: [] }));
    else this.deliver(keys, added, features);
    return true;
  }

  /**
   * `setKeys` for a caller that walks the features itself in slices (WP-848): sets the keys (a new key's values are not
   * sent yet) and returns the keys that are new; the caller then gives every slice to `addValues`. Unchanged keys: undefined.
   */
  beginKeys(keys: readonly string[]): readonly string[] | undefined {
    const same = keys.length === this.keys.length && keys.every((k) => this.keys.includes(k));
    if (same) return undefined;
    const added = keys.filter((k) => !this.keys.includes(k));
    this.keys = keys;
    this.send(() => this.transport.post({ type: 'keys', keys, values: [] }));
    return added;
  }

  /** The values of `keys` of one slice of features, after `beginKeys`; features the worker does not hold are ignored there. */
  addValues(keys: readonly string[], features: readonly MapFeature[]): void {
    const values: { id: string; props: { [key: string]: Json } }[] = [];
    for (const f of features) {
      const props = pickProps(f, keys);
      if (Object.keys(props).length > 0) values.push({ id: f.id as string, props });
    }
    if (values.length > 0) this.send(() => this.transport.post({ type: 'values', values }));
  }

  /** Sets the classifying property: clusters then carry per-value counts (its key must be one of the keys). */
  setClassify(key: string | undefined): void {
    this.send(() => this.transport.post({ type: 'classify', ...(key === undefined ? {} : { key }) }));
  }

  /** Sets the project's max zoom (`map.max_zoom`); `undefined` is v3's default, 19. */
  setMaxZoom(maxZoom: number | undefined): void {
    this.send(() => this.transport.post({ type: 'maxZoom', ...(maxZoom === undefined ? {} : { maxZoom }) }));
  }

  query(bbox: Bbox, zoom: number): Promise<readonly ClusterItem[]> {
    return this.queryCapped(bbox, zoom, undefined).then((a) => a.items);
  }

  /** With a `cap` (the Cluster tool): the features in view are drawn singly when there are at most that many; `stats` says what happened. */
  queryCapped(bbox: Bbox, zoom: number, cap: number | undefined): Promise<ClusterAnswer> {
    const reqId = this.nextReq++;
    return new Promise((resolve) => {
      this.clusterWaiters.set(reqId, resolve);
      this.send(() =>
        this.transport.post({ type: 'query', reqId, bbox, zoom, ...(cap === undefined ? {} : { cap }) }),
      );
    });
  }

  /** The members of a cluster as singles (a tap on it, WP-653). */
  leaves(clusterId: number): Promise<readonly ClusterItem[]> {
    const reqId = this.nextReq++;
    return new Promise((resolve) => {
      this.leavesWaiters.set(reqId, resolve);
      this.send(() => this.transport.post({ type: 'leaves', reqId, clusterId }));
    });
  }

  /** The held features of these ids as singles; ids the worker does not hold are left out (WP-647). */
  byIds(ids: readonly string[]): Promise<readonly ClusterItem[]> {
    const reqId = this.nextReq++;
    return new Promise((resolve) => {
      this.byIdsWaiters.set(reqId, resolve);
      this.send(() => this.transport.post({ type: 'byIds', reqId, ids }));
    });
  }

  /** Runs `job` now, or after the chunked delivery in flight, so the worker sees messages in order. */
  private send(job: () => void): void {
    if (this.tail === undefined) job();
    else this.enqueue(this.tail.then(job));
  }

  private enqueue(step: Promise<void>): void {
    const mine: Promise<void> = step.then(() => {
      if (this.tail === mine) this.tail = undefined;
    });
    this.tail = mine;
  }

  /**
   * Posts the keys with the values of the first chunk at once (so a small delivery is one message,
   * as before), then the rest in chunks of `chunkSize` (default CHUNK_SIZE), yielding between chunks so no main-thread
   * task exceeds one chunk. Posts made meanwhile wait, so the worker applies everything in call
   * order and a query answers after the last chunk.
   */
  private deliver(keys: readonly string[], added: readonly string[], source: readonly MapFeature[]): void {
    const features = source.slice(); // the caller may mutate its array while chunks are still pending
    const size = this.chunkSize;
    const chunk = (at: number): { id: string; props: { [key: string]: Json } }[] => {
      const values = [];
      for (const f of features.slice(at, at + size)) {
        const props = pickProps(f, added);
        if (Object.keys(props).length > 0) values.push({ id: f.id as string, props });
      }
      return values;
    };
    const first = () => this.transport.post({ type: 'keys', keys, values: chunk(0) });
    if (features.length <= size) {
      this.send(first);
      return;
    }
    const rest = async (): Promise<void> => {
      for (let at = size; at < features.length; at += size) {
        await this.yieldNow();
        const values = chunk(at);
        if (values.length > 0) this.transport.post({ type: 'values', values });
      }
    };
    this.send(first);
    this.enqueue((this.tail ?? Promise.resolve()).then(rest));
  }

  close(): void {
    this.transport.close();
  }
}

function pickProps(f: MapFeature, keys: readonly string[]): { [key: string]: Json } {
  const out: { [key: string]: Json } = {};
  for (const k of keys) {
    const v = f.properties[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}
