// Messages between the main thread and the clustering worker. The main thread sends only deltas
// (anchors, ids) and receives only cluster output for the current viewport.
import type { Bbox } from '@ueberblick/core/geo';
import type { Json } from '@ueberblick/core/model';

/** A feature's anchor as the worker sees it. */
export interface ClusterPoint {
  readonly id: string;
  readonly lng: number;
  readonly lat: number;
  /** Only the property keys the view's style uses (see `KeysMessage`). */
  readonly props?: { readonly [key: string]: Json };
}

export interface ApplyMessage {
  readonly type: 'apply';
  readonly add: readonly ClusterPoint[];
  readonly update: readonly ClusterPoint[];
  readonly remove: readonly string[];
}
export interface QueryMessage {
  readonly type: 'query';
  readonly reqId: number;
  readonly bbox: Bbox;
  readonly zoom: number;
  /** Un-cluster (WP-666): draw the features in view singly when there are at most this many. */
  readonly cap?: number;
}
/**
 * The property keys the style uses, in full. `values` carries the newly needed keys for features
 * the worker already holds; keys no longer listed are dropped in the worker.
 */
export interface KeysMessage {
  readonly type: 'keys';
  readonly keys: readonly string[];
  readonly values: readonly { readonly id: string; readonly props: { readonly [key: string]: Json } }[];
}
/** More values for the keys of the last `keys` message: one chunk, merged into held points. */
export interface ValuesMessage {
  readonly type: 'values';
  readonly values: KeysMessage['values'];
}
/** The members of a cluster (a tap on it opens the cluster detail, WP-653). */
export interface LeavesMessage {
  readonly type: 'leaves';
  readonly reqId: number;
  readonly clusterId: number;
}
/** The classifying property (WP-674): clusters then carry per-value `counts`. `key` absent turns them off. */
export interface ClassifyMessage {
  readonly type: 'classify';
  readonly key?: string;
}
/** The held anchors of these ids (the drill-down of a cluster or a relation, WP-653/647): O(ids). */
export interface ByIdsMessage {
  readonly type: 'byIds';
  readonly reqId: number;
  readonly ids: readonly string[];
}
/** The project's max zoom (v3 `getGlobalMaxZoom`): the index separates all features above it. `maxZoom` absent is v3's default, 19. */
export interface MaxZoomMessage {
  readonly type: 'maxZoom';
  readonly maxZoom?: number;
}
export type ToWorker =
  | MaxZoomMessage
  | ApplyMessage
  | KeysMessage
  | ValuesMessage
  | QueryMessage
  | LeavesMessage
  | ByIdsMessage
  | ClassifyMessage;

/** One output item: a single feature (`featureId`) or a cluster (`clusterId`, `count`). */
export interface ClusterItem {
  readonly lng: number;
  readonly lat: number;
  readonly featureId?: string;
  readonly clusterId?: number;
  readonly count?: number;
  /** A cluster of a type with a classifying property: how many members hold each value (`_unset`: none). */
  readonly counts?: { readonly [value: string]: number };
  /** Style-used properties of a single feature; clusters carry none. */
  readonly properties?: { readonly [key: string]: Json };
}

/** The answer of a capped query beside its items (the Cluster tool's stats line). */
export interface CappedStats {
  readonly inView: number;
  readonly single: boolean;
}

export interface ClustersMessage {
  readonly type: 'clusters';
  readonly reqId: number;
  readonly items: readonly ClusterItem[];
  /** Only for a query with a `cap`: how many features are in view, and whether they were drawn singly. */
  readonly stats?: CappedStats;
}
export interface LeavesResultMessage {
  readonly type: 'leaves';
  readonly reqId: number;
  /** The members as singles, in the shape `query` gives them. */
  readonly items: readonly ClusterItem[];
}
export interface ByIdsResultMessage {
  readonly type: 'byIds';
  readonly reqId: number;
  /** The ids the worker holds, as singles; unknown ids are left out. */
  readonly items: readonly ClusterItem[];
}
export type FromWorker = ClustersMessage | LeavesResultMessage | ByIdsResultMessage;

/** The channel to the worker. Real: a Web Worker. Tests and benchmarks: in-process. */
export interface ClusterTransport {
  post(message: ToWorker): void;
  onMessage(listener: (message: FromWorker) => void): void;
  close(): void;
}
