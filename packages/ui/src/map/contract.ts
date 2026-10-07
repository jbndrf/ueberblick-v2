// The map contract: a view renderer draws folded features and reports taps (H1: renderers are
// looked up by their registry key). Nothing MapLibre-specific appears here.
import type { Bbox, Geometry, Position } from '@ueberblick/core/geo';
import type { FeatureId, Json, MapConfig } from '@ueberblick/core/model';
import type { MapSelection, RendererKey } from '@ueberblick/core/registry';
import type { MarkerLooks } from '@ueberblick/core/marker';
import type { View } from '@ueberblick/core/model';
import type { PackRouting, TileProxy } from './maplibre/packs-types';

/** A folded feature reduced to what a renderer needs. Z stays in `geometry` and `anchor` (H1). */
export interface MapFeature {
  readonly id: FeatureId;
  /** `derived.pointOnSurface` of the drawn geometry property; never a vertex mean. */
  readonly anchor: Position;
  readonly geometry: Geometry;
  readonly properties: { readonly [key: string]: Json };
}

/** One incremental change to the features in view. */
export interface FeatureChange {
  readonly add: readonly MapFeature[];
  readonly update: readonly MapFeature[];
  readonly remove: readonly FeatureId[];
}

export type Unsubscribe = () => void;

/**
 * Where a renderer gets features. `subscribe` first delivers the current features in `bbox` as one
 * `add`, then only changes (H5: live positions are just another source).
 */
export interface FeatureSource {
  query(bbox: Bbox): readonly MapFeature[];
  /**
   * The same features as `query`, in the same order, lazily in slices: a caller that yields between slices never runs a
   * task as long as the whole walk (a large view, WP-848). `size` is the number of features a slice looks at.
   */
  queryChunks(bbox: Bbox, size?: number): Generator<readonly MapFeature[]>;
  subscribe(bbox: Bbox, listener: (change: FeatureChange) => void): Unsubscribe;
}

/**
 * How a tool overlay looks. Colours are design-system token values the caller passes in (for example
 * `THEMES[theme].color.primary`); a renderer never picks its own. Renderer-neutral: no MapLibre names (H1).
 */
export interface OverlayStyle {
  /** Line, outline and point colour. */
  readonly color: string;
  /** Fill of areas; the line colour when absent. */
  readonly fillColor?: string;
  /** Line width in px (a renderer with no pixel notion scales it). */
  readonly width?: number;
  /** Draws lines dashed (v3's placement connector); solid when absent. */
  readonly dashed?: boolean;
  /** Opacity of lines, 0 to 1; 1 when absent. */
  readonly opacity?: number;
  /**
   * Point overlays only: also draws a circle of this radius in true metres (it scales with the zoom) under the
   * point, with a 10 % fill (v3's Standort accuracy). A renderer without metres ignores it.
   */
  readonly accuracy?: number;
}

/** A point on screen in px, relative to the top-left corner of the map's box. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** A DOM marker the caller draws (its design tokens), pinned to a WGS84 position (H1: no MapLibre names). */
export interface MarkerOptions {
  /** The marker's look. The renderer anchors its middle on the position and never restyles it. */
  readonly element: HTMLElement;
  /** The person may drag it; `onMarkerDrag` reports the new position. */
  readonly draggable?: boolean;
}

/** The lowest and highest zoom the map allows (integers 0 to 24 in the project file). */
export interface ZoomBounds {
  readonly min?: number;
  readonly max?: number;
}

export interface CenterOptions {
  /** Zoom for a point target; the zoom stays when absent. A bbox target is fitted and ignores it. */
  readonly zoom?: number;
  /** Zooms in to at least this zoom and never out (v3 fly-to: `max(current zoom, 17)`); a point target only. */
  readonly minZoom?: number;
  /**
   * Pixels of the map that sheets cover (v3 `flyToWithOffset`): the point lands in the middle of the part left free,
   * so half of each is shifted. A point target only.
   */
  readonly offset?: { readonly right?: number; readonly bottom?: number };
}

/** One feature inside a tapped cluster. */
export interface ClusterMember {
  readonly id: FeatureId;
  /** WGS84 [lon, lat] of where the cluster drew it. */
  readonly at: Position;
}

/** A tap on a cluster (v3 opened its detail sheet on it). Costs the cluster's size, never the number of features. */
export interface ClusterTap {
  /** WGS84 [lon, lat] of the cluster. */
  readonly at: Position;
  readonly count: number;
  readonly members: readonly ClusterMember[];
}

/** What the Cluster tool shows: the features in view, and whether they are all drawn singly (within the cap). */
export interface UnclusterStats {
  readonly inView: number;
  readonly single: boolean;
}

/** The feature whose sheet is open and the colour of its highlight (a design-system token value the caller passes in). */
export interface Selection {
  readonly id: FeatureId;
  readonly color: string;
}

export interface MapHandle {
  /** Resolves when the renderer is drawn and interactive. Rejects when it could not load. */
  readonly ready: Promise<void>;
  /** `featureTap(id)`: a feature was tapped. */
  onFeatureTap(listener: (id: FeatureId) => void): Unsubscribe;
  /**
   * `clusterTap(tap)`: a single tap on a cluster, 300 ms after it, so a second tap on the same cluster can zoom to
   * its members instead (v3's double tap); that second tap does not fire this. Optional: a renderer without
   * clusters (3D) omits it.
   */
  onClusterTap?(listener: (tap: ClusterTap) => void): Unsubscribe;
  /**
   * v3's drill-down (`+page.svelte:1871-1925`): draws only these features, one by one, and fits them in view. They can
   * be members of a tapped cluster or any other features (a relation's children, v3 `onFocusRelation`): the ids are
   * resolved against the renderer's own feature source, O(ids), so callers pass ids only. The view it left is kept at
   * the first call, so a second call (another row) keeps it. `null` draws the clusters again and flies back to the kept
   * view; with nothing isolated it does nothing. Ids the renderer does not hold are ignored; with none left nothing
   * changes. The latest call wins.
   */
  isolate?(ids: readonly FeatureId[] | null): void;
  /**
   * `mapTap(at)`: a tap on empty map, not on a feature or cluster (those fire `onFeatureTap` only).
   * `at` is WGS84 [lon, lat].
   */
  onMapTap(listener: (at: Position) => void): Unsubscribe;
  /**
   * A tool that owns the tap (the placement pin, the draw tool; v3 `isEditingLocation`) switches this on: while on,
   * every tap is a `mapTap` with its position, also over a feature, an area or a cluster (a tree inside an area can
   * be moved). Off by default; a renderer without taps omits it.
   */
  captureTaps?(on: boolean): void;
  /**
   * Moves the view to a WGS84 point or fits a bbox. Animated, except when the user prefers reduced motion
   * (docs/13): then the view jumps.
   */
  centerOn(target: Position | Bbox, opts?: CenterOptions): void;
  /**
   * Zooms by `delta` levels around the current centre (the zoom buttons, WCAG 2.5.1). Animated, except when the
   * user prefers reduced motion. Ignored until the map is drawn.
   */
  zoomBy(delta: number): void;
  /**
   * Marks the feature whose sheet is open: a ring around a point, a heavier stroke and fill on
   * a line or area; `null` removes it. O(1): the renderer filters its highlight layers on the id and never rewrites the
   * features. A feature the renderer does not draw (inside a cluster) shows no mark. Optional: a renderer without it
   * (3D) omits it.
   */
  setSelected?(selection: Selection | null): void;
  /**
   * Shows a temporary geometry above the features, under `id`; the same `id` replaces it. Overlays survive
   * `setView`, are drawn without re-sending features, and are never a write.
   */
  showOverlay(id: string, geometry: Geometry, style: OverlayStyle): void;
  /** Removes the overlay `id`; an unknown id is ignored. */
  clearOverlay(id: string): void;
  /**
   * Pins `options.element` at WGS84 `at` under `id`; the same `id` replaces it. Markers are not features: they are
   * never sent to the cluster worker and moving one re-draws nothing else, so a drag stays at frame rate.
   */
  addMarker(id: string, at: Position, options: MarkerOptions): void;
  /** Moves marker `id`; an unknown id is ignored. Does not fire `onMarkerDrag`. */
  moveMarker(id: string, at: Position): void;
  /** Where marker `id` is, or undefined when there is none. */
  markerPosition(id: string): Position | undefined;
  /** Removes marker `id`; an unknown id is ignored. */
  removeMarker(id: string): void;
  /** `at` of a marker the person drags: on every move of the drag and once more when it ends. */
  onMarkerDrag(listener: (id: string, at: Position) => void): Unsubscribe;
  /** Turns double-click and double-tap zoom on or off (v3 turned it off while drawing, so two quick taps add two vertices). On by default. */
  setDoubleClickZoom(on: boolean): void;
  /** WGS84 to screen px in the map's box; undefined until the map is drawn. */
  project(at: Position): ScreenPoint | undefined;
  /** Screen px in the map's box to WGS84; undefined until the map is drawn. */
  unproject(point: ScreenPoint): Position | undefined;
  /** Fires on every frame the view moves (pan, zoom, animation), unlike `onExtentChange` which fires when it settles. */
  onMove(listener: () => void): Unsubscribe;
  /** The current map extent; the list alternative shows the features inside it. */
  extent(): Bbox;
  onExtentChange(listener: (extent: Bbox) => void): Unsubscribe;
  /**
   * Un-cluster (the Cluster tool, v3 "Gruppierung aufheben"): with a number, the features in view are drawn singly
   * while there are at most that many (more stay clustered); `null` clusters as usual. Clustering itself stays on.
   * Optional: a renderer without clusters (3D) omits it.
   */
  setUncluster?(cap: number | null): void;
  /** Reports, after each query while un-clustering is on, how many features are in view and whether they are drawn singly. Calls the listener at once with the last report, if any. */
  onUnclusterStats?(listener: (stats: UnclusterStats) => void): Unsubscribe;
  /**
   * Draws the project's map backgrounds (base and overlays, already filtered to the person's roles) below the
   * features: the selection says which are on. Called again on every change of the choice; only the layers that
   * changed are touched, and no feature is re-sent. Optional: a renderer without backgrounds (3D) omits it.
   */
  setBasemaps?(config: MapConfig, selection: MapSelection): void;
  /**
   * The look of the view's feature type by value (WP-674, B-018): the marker icon and colour per value of the
   * classifying property, the colour of shapes, and per-value counts in clusters. `undefined` draws the default.
   * Optional: a renderer without markers (3D) omits it. Features are not re-sent.
   */
  setLooks?(looks: MarkerLooks | undefined): void;
  /**
   * The project's zoom limits (`map.min_zoom`, `map.max_zoom`): the map never zooms outside them, by hand or by a
   * fit, fly-to or camera of the renderer's own. Either may be absent (the renderer's default); `undefined` lifts both.
   * Optional: a renderer without zoom levels (3D) omits it.
   */
  setZoomBounds?(bounds: ZoomBounds | undefined): void;
  /** Switches to another view's style. Features are not re-sent. Throws when the style is invalid. */
  setView(view: View): void;
  destroy(): void;
}

export interface ViewRenderer {
  mount(el: HTMLElement, view: View, source: FeatureSource): MapHandle;
}

/** Renderers by registry key (`RENDERERS`). */
/** What the app gives the built-in renderers (WP-650): the offline-pack tile protocol of this device. */
export interface RendererMapOptions {
  readonly packProtocol?: PackRouting;
  /** The project's tile proxy (A-033): proxied layers load from it, never from their provider. */
  readonly proxy?: TileProxy;
}

export type RendererMap = ReadonlyMap<RendererKey | string, ViewRenderer>;

/** The renderer key is not registered. Typed so callers can tell it from a load failure. */
export class UnknownRendererError extends Error {
  readonly rendererKey: string;
  constructor(rendererKey: string) {
    super(`No view renderer registered for "${rendererKey}"`);
    this.name = 'UnknownRendererError';
    this.rendererKey = rendererKey;
  }
}

export interface ListColumn {
  readonly key: string;
  readonly label: string;
  /** How a cell reads (an option's label, a date in the app language); the raw value when absent. */
  readonly format?: (value: Json | undefined) => string;
}

/** Strings come from the app (Paraglide); the list has no literal text. */
export interface FeatureListLabels {
  readonly caption: string;
  readonly empty: string;
  readonly sortedAscending: string;
  readonly sortedDescending: string;
  /** Header of the first column, which holds each feature's display name. */
  readonly name: string;
}

/** The sort key of the name column (a `$` cannot start a property key). */
export const NAME_SORT = '$name';

/** One row of the list: a feature reduced to its display name and the values of the columns. */
export interface ListItem extends Pick<MapFeature, 'id' | 'properties'> {
  readonly name: string;
}

export interface FeatureListProps {
  features: readonly ListItem[];
  columns: readonly ListColumn[];
  labels: FeatureListLabels;
  /** Initial sort as in the view: property keys, a leading "-" sorts descending. */
  sort?: readonly string[];
  onFeatureTap: (id: FeatureId) => void;
}

/** Strings come from the app (Paraglide); the map has no literal text. */
export interface MapDescriptionLabels {
  /** Accessible name of the map itself. */
  readonly map: string;
  /** Accessible description of the map: says the same features are in the list alternative. */
  readonly mapDescription: string;
}
