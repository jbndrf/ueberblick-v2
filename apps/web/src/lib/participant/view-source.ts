/**
 * The `FeatureSource` of one view (H1: renderers only see this port; H5: a live-position layer is another source).
 * It reads the device's `Facts`, which already lay the predictions of queued runs over the synced state, so a feature
 * a participant just created offline is on the map at once. The view's filters are the rule language, evaluated by
 * `core.expr` (R1); the anchor is the fold's `pointOnSurface`, never a vertex mean (decision 0013).
 *
 * A change is found by comparing state objects with what was sent last (the store hands out the same object until a
 * feature changes), so an untouched feature costs one comparison and is not sent again. A committed page names its
 * feature ids (`DeviceStore.onChange`, WP-567), so a pull costs O(changed features); a queued run names the
 * features of its prediction (`device.ts`, WP-800), so it costs O(touched features) too. Only `ALL` (a store reset, a
 * new config version) walks the types of the view once. A view filter that reads
 * a related feature is re-evaluated for the changed feature only, so it can be stale until the next full walk.
 */
import { displayName } from '@ueberblick/core/locale';
import type { Bbox, Geo, Position } from '@ueberblick/core/geo';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, FeatureId, FeatureState, Instant, Key, Json } from '@ueberblick/core/model';
import { lookKeyOfProperties, LOOK_KEY, viewLooks, type MarkerLooks } from '@ueberblick/core/marker';
import type { Facts } from '@ueberblick/core/ports';
import { formatKeyPath } from '@ueberblick/core/template';
import type { FeatureChange, FeatureSource, MapFeature } from '@ueberblick/ui';
import { ALL, type ChangeFeed } from './changed';
import { isServed } from '@ueberblick/core';
import { viewPass } from './map/view-pass';
import { createFamilyView, drawnDiffers } from './map/family-view';

const WORLD: Bbox = [-180, -90, 180, 90];

export interface ViewSourceDeps {
  readonly facts: Pick<Facts, 'feature' | 'near' | 'ofType' | 'edgesFrom' | 'edgesTo' | 'history'>;
  readonly config: CompiledConfig;
  readonly viewKey: string;
  readonly actor: Actor;
  readonly geo: Geo;
  readonly now: () => Instant;
  /** Rings with the features that may have changed: the ids of a page, or every feature. */
  readonly changed: Pick<ChangeFeed, 'subscribe'>;
}

interface Selected {
  readonly type: Key;
  /** Key path of the compiled filter, when the source has one. */
  readonly filter: string | undefined;
}

/** What the view draws: the sources of its layers that name one, else the view's own source. */
export function selectedSources(config: CompiledConfig, viewKey: string): readonly Selected[] {
  const view = config.file.views?.[viewKey];
  if (view === undefined) return [];
  const own = (): Selected => ({
    type: view.source.type as Key,
    filter:
      view.source.filter === undefined ? undefined : formatKeyPath(['views', viewKey, 'source', 'filter']),
  });
  const fromLayers = Object.entries(view.layers ?? {}).flatMap(([layerKey, layer]): Selected[] => {
    const s = layer.source;
    if (s === undefined || !('type' in s)) return [];
    return [
      {
        type: s.type as Key,
        filter:
          s.filter === undefined
            ? undefined
            : formatKeyPath(['views', viewKey, 'layers', layerKey, 'source', 'filter']),
      },
    ];
  });
  return fromLayers.length > 0 ? fromLayers : [own()];
}

const isPoint = (g: unknown): g is { type: 'Point'; coordinates: Position } =>
  typeof g === 'object' && g !== null && (g as { type?: unknown }).type === 'Point';

/** What both the map source and the list read: the view's sources, its filter and how a feature is drawn (R1). */
function createViewParts(deps: Omit<ViewSourceDeps, 'changed'>) {
  const { config, geo } = deps;
  const own = selectedSources(config, deps.viewKey);
  const fam = createFamilyView({ config, facts: deps.facts, geo });
  const selected = own; // a child type is drawn only through a layer of the view, with that layer's filter (B-019)
  const anchors = new WeakMap<object, Position>();

  const anchorOf = (geometry: object): Position => {
    if (isPoint(geometry)) return geometry.coordinates;
    let a = anchors.get(geometry);
    if (a === undefined) {
      a = geo.derive(geometry as never).pointOnSurface.coordinates;
      anchors.set(geometry, a);
    }
    return a;
  };

  const evaluator = (): ((state: FeatureState, s: Selected) => boolean) => viewPass(deps);

  const toMap = (state: FeatureState): MapFeature | undefined => {
    const key = config.foldTypes.get(state.type)?.primaryGeometry;
    const at = fam.inherits(state.type) ? fam.anchorOf(state.id) : undefined;
    const geometry =
      at !== undefined
        ? { type: 'Point', coordinates: at }
        : key === undefined
          ? undefined
          : state.properties[key];
    if (
      !isServed(state.lifecycle) ||
      geometry === undefined ||
      geometry === null ||
      typeof geometry !== 'object'
    )
      return undefined;
    return {
      id: state.id,
      anchor: anchorOf(geometry),
      geometry: geometry as unknown as MapFeature['geometry'],
      properties: withLook(state),
    };
  };

  /** The feature's properties and the key of its look (WP-744): the renderer draws every Objektart from one plan. */
  const withLook = (state: FeatureState): { readonly [key: string]: Json } => {
    const type = config.file.types?.[state.type];
    const look = type === undefined ? undefined : lookKeyOfProperties(state.type, type, state.properties);
    const extra = { ...(look === undefined ? {} : { [LOOK_KEY]: look }), ...fam.openProps(state) };
    return Object.keys(extra).length === 0
      ? (state.properties as { readonly [key: string]: Json })
      : ({ ...state.properties, ...extra } as { readonly [key: string]: Json });
  };

  const inside = (f: MapFeature, bbox: Bbox): boolean =>
    f.anchor[0] >= bbox[0] && f.anchor[0] <= bbox[2] && f.anchor[1] >= bbox[1] && f.anchor[1] <= bbox[3];

  return { selected, evaluator, toMap, inside, fam };
}

/** Features one slice of a pass looks at (about 10 ms raw with a one-hop filter at 60k, so within the long-task row at x4). */
export const PASS_SLICE = 4000;

type Drawn = { readonly state: FeatureState; readonly map: MapFeature };

/** The map source of a view, with its pass also available in slices (WP-847) for a caller that yields between them. */
export interface ViewFeatureSource extends FeatureSource {
  /** The same features as `query`, in the same order, in slices of about `size` features looked at (the cost is the look). */
  queryChunks(bbox: Bbox, size?: number): Generator<readonly MapFeature[]>;
  /** The view draws this feature (its type is drawn and it passes the view's own filter): the filter's switches are not asked. */
  has(id: FeatureId): boolean;
}

export function createViewSource(deps: ViewSourceDeps): ViewFeatureSource {
  const { facts } = deps;
  const { selected, evaluator, toMap, inside, fam } = createViewParts(deps);

  /**
   * The pass over the view's types in slices of about `size` features looked at: a fresh evaluator per slice (its memo
   * is not invalidated, and the facts may change between slices). With a `bbox` a feature must lie inside it.
   */
  function* pass(bbox: Bbox, size: number, bounded: boolean): Generator<Drawn[], Drawn[]> {
    const seen = new Set<FeatureId>();
    let out: Drawn[] = [];
    let looked = 0;
    let accepts = evaluator();
    // the whole world reads the type lazily (`ofType`): `near` copies every match first, which is itself a long task at 60k
    const unbounded = bbox.every((v, i) => v === WORLD[i]);
    for (const s of selected) {
      for (const state of unbounded ? facts.ofType(s.type) : facts.near(s.type, bbox)) {
        if (++looked > size) {
          yield out;
          out = [];
          looked = 0;
          accepts = evaluator();
        }
        if (seen.has(state.id) || !accepts(state, s)) continue;
        const map = toMap(state);
        if (map === undefined || (bounded && !inside(map, bbox))) continue;
        seen.add(state.id);
        out.push({ state, map });
      }
    }
    return out; // the last slice is returned, not yielded: a caller knows when no more follows
  }
  function* slicesOf(bbox: Bbox, size: number): Generator<Drawn[]> {
    const last = yield* pass(bbox, size, true);
    if (last.length > 0) yield last;
  }

  const queryBox = (bbox: Bbox): MapFeature[] =>
    [...slicesOf(bbox, Number.POSITIVE_INFINITY)].flat().map((e) => e.map);

  const has = (id: FeatureId): boolean => {
    const state = facts.feature(id);
    if (state === undefined) return false;
    const accepts = evaluator();
    return selected.some((s) => s.type === state.type && accepts(state, s) && toMap(state) !== undefined);
  };

  return {
    has,
    query: queryBox,
    *queryChunks(bbox, size = PASS_SLICE) {
      for (const slice of slicesOf(bbox, size)) yield slice.map((e) => e.map);
    },

    subscribe(_bbox, listener) {
      const sent = new Map<FeatureId, Drawn>();
      let closed = false;
      let generation = 0;
      const emit = (add: MapFeature[], update: MapFeature[], remove: FeatureId[]): void => {
        if (add.length + update.length + remove.length > 0) {
          const change: FeatureChange = { add, update, remove };
          listener(change);
        }
      };
      /** A feature as the view draws it now, or undefined when it is not in the view. */
      const drawn = (id: FeatureId): Drawn | undefined => {
        const state = facts.feature(id);
        if (state === undefined) return undefined;
        const accepts = evaluator();
        for (const s of selected) {
          if (s.type !== state.type || !accepts(state, s)) continue;
          const map = toMap(state);
          if (map !== undefined) return { state, map };
        }
        return undefined;
      };
      /** What one slice of a walk changes against what was sent: adds and updates, remembered. */
      const apply = (slice: readonly Drawn[], seen: Set<FeatureId>): [MapFeature[], MapFeature[]] => {
        const add: MapFeature[] = [];
        const update: MapFeature[] = [];
        for (const entry of slice) {
          seen.add(entry.state.id);
          const before = sent.get(entry.state.id);
          if (before === undefined) add.push(entry.map);
          else if (drawnDiffers(before, entry)) update.push(entry.map);
          else continue;
          sent.set(entry.state.id, entry);
        }
        return [add, update];
      };
      /**
       * A walk over the whole view (the first delivery, or `ALL`): the first slice runs now, so a view of up to
       * `PASS_SLICE` features is delivered synchronously; the rest follow after a yield each (no long task, WP-847).
       * A newer walk, or `unsubscribe`, ends this one. A change of named features while a walk runs is applied at
       * once; the walk then finds `sent` already current for them.
       */
      const walk = async (): Promise<void> => {
        const mine = ++generation;
        const before = new Set(sent.keys());
        const seen = new Set<FeatureId>();
        const slices = pass(WORLD, PASS_SLICE, false);
        for (;;) {
          const n = slices.next();
          const [add, update] = apply(n.value, seen);
          if (n.done === true) {
            const remove: FeatureId[] = [];
            for (const id of before) {
              if (seen.has(id) || drawn(id) !== undefined) continue;
              if (sent.delete(id)) remove.push(id);
            }
            emit(add, update, remove);
            return;
          }
          emit(add, update, []);
          await new Promise((r) => setTimeout(r, 0));
          if (closed || mine !== generation) return;
        }
      };
      void walk();
      const stop = deps.changed.subscribe((changed) => {
        if (changed === ALL) {
          void walk();
          return;
        }
        const add: MapFeature[] = [];
        const update: MapFeature[] = [];
        const remove: FeatureId[] = [];
        for (const id of fam.reach(changed)) {
          const before = sent.get(id);
          const entry = drawn(id);
          if (entry === undefined) {
            if (before !== undefined) {
              remove.push(id);
              sent.delete(id);
            }
          } else if (before === undefined) {
            add.push(entry.map);
            sent.set(id, entry);
          } else if (drawnDiffers(before, entry)) {
            update.push(entry.map);
            sent.set(id, entry);
          }
        }
        emit(add, update, remove);
      });
      return () => {
        closed = true;
        stop();
      };
    },
  };
}

/** One row of a list: a feature the view shows, with or without a position (R4). */
export interface ListRow {
  readonly id: FeatureId;
  /** The display name (`displayName`, the same as the sheet header), read from the row: no fold (WP-593). */
  readonly name: string;
  readonly properties: { readonly [key: string]: Json };
}

export interface ViewList {
  /** The rows now. With an `extent`, a feature that has a position shows only inside it; one without always shows. */
  rows(extent?: Bbox): readonly ListRow[];
  /** The same rows as `rows`, in the same order, lazily in slices of about `size`: the caller yields between slices (WP-805). */
  rowChunks(extent?: Bbox, size?: number): Generator<readonly ListRow[]>;
  /** The rows of just these features (the ones the view shows, inside `extent` when given): O(ids), no scan of the facts. */
  rowsOf(ids: Iterable<FeatureId>, extent?: Bbox): readonly ListRow[];
  /** The same rows named for `locales` (a runtime language switch, WP-761): O(rows), no scan of the facts. */
  rename(rows: readonly ListRow[], locales: readonly string[]): readonly ListRow[];
}

/**
 * The list of one view (an own-list such as "my work orders"): every feature the view filter accepts, read with
 * `Facts.ofType`, so a feature without geometry is a row like any other. `rows` is O(features of the view's types),
 * called when the Liste is shown; `rowsOf` is O(ids) for a burst that names its features (WP-800).
 */
export function createViewList(
  deps: Omit<ViewSourceDeps, 'changed'> & { readonly locales: readonly string[] },
): ViewList {
  const { selected, evaluator, toMap, inside } = createViewParts(deps);
  const rowOf = (state: FeatureState): ListRow => ({
    id: state.id,
    name: displayName(deps.config.file.types?.[state.type], state, deps.locales),
    properties: state.properties as ListRow['properties'],
  });
  return {
    rows(extent) {
      return [...this.rowChunks(extent, Number.POSITIVE_INFINITY)].flat();
    },
    *rowChunks(extent, size = 1000) {
      const seen = new Set<FeatureId>();
      let out: ListRow[] = [];
      let scanned = 0;
      let accepts = evaluator();
      for (const s of selected) {
        for (const state of deps.facts.ofType(s.type)) {
          // a slice ends after `size` features scanned, not rows kept: the scan is the cost
          if (++scanned >= size) {
            yield out;
            out = [];
            scanned = 0;
            accepts = evaluator(); // a fresh memo per slice: the facts may change between slices
          }
          if (seen.has(state.id) || !accepts(state, s)) continue;
          const drawn = toMap(state);
          if (drawn !== undefined && extent !== undefined && !inside(drawn, extent)) continue;
          seen.add(state.id);
          out.push(rowOf(state));
        }
      }
      if (out.length > 0) yield out;
    },
    rowsOf(ids, extent) {
      const out: ListRow[] = [];
      const accepts = evaluator();
      for (const id of ids) {
        const state = deps.facts.feature(id);
        if (state === undefined || !isServed(state.lifecycle)) continue;
        for (const s of selected) {
          if (s.type !== state.type || !accepts(state, s)) continue;
          const drawn = toMap(state);
          if (drawn !== undefined && extent !== undefined && !inside(drawn, extent)) break;
          out.push(rowOf(state));
          break;
        }
      }
      return out;
    },
    rename(rows, locales) {
      return rows.map((r) => {
        const state = deps.facts.feature(r.id);
        return state === undefined
          ? r
          : { ...r, name: displayName(deps.config.file.types?.[state.type], state, locales) };
      });
    },
  };
}

/**
 * The looks of every Objektart the view draws (WP-744; v3 registered every workflow's icons in one symbol layer,
 * `map-icons.ts:1-14`). The filter sheet resolves the same looks (`resolveMarker`), so map and sheet match.
 * Types, not features: O(types) per call, and the source data is not touched.
 */
export function drawnLooks(config: CompiledConfig, viewKey: string): MarkerLooks | undefined {
  const drawn = selectedSources(config, viewKey).map((s) => s.type);
  return viewLooks(config.file.types ?? {}, drawn);
}
