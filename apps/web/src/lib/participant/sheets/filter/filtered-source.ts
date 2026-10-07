/**
 * The map's `FeatureSource` with the filter laid over it: a hidden Objektart or stage is never given to the renderer
 * (H1: renderers only see the source port; the renderer has no filter call of its own). A switch costs one query of
 * the subscribed extent and one event with the difference, never a scan over all features. The map pane hands the
 * renderer this source instead of `device.viewSource(...)`.
 */
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Bbox } from '@ueberblick/core/geo';
import type { FeatureId, FeatureState, Key } from '@ueberblick/core/model';
import { classifyingProperty } from '@ueberblick/core';
import { FAMILY_OPEN_KEY } from '@ueberblick/core/marker';
import type { FeatureChange, FeatureSource, MapFeature } from '@ueberblick/ui';
import type { ActiveView, FilterController } from './filter-controller';
import { isVisible } from './filter-state';
import type { ViewPass } from './view-pass';
import { PASS_SLICE } from '../../view-source';

/** The predicate of an active view; undefined when the view cannot be evaluated (the switches then apply). */
export type ViewPassOf = (view: ActiveView) => ViewPass | undefined;

/** Whether the filter lets a feature through: the one definition for the map and the Liste (R1). */
export function visibleOf(
  lookup: (id: FeatureId) => FeatureState | undefined,
  config: CompiledConfig,
  filter: FilterController,
  viewPassOf?: ViewPassOf,
): (id: FeatureId) => boolean {
  const stageKeys = new Map<Key, string | undefined>(
    Object.entries(config.file.types ?? {}).map(([k, t]) => [k as Key, classifyingProperty(t)]),
  );
  let passFor: { view: ActiveView | null; revision: number; pass: ViewPass | undefined } = {
    view: null,
    revision: 0,
    pass: undefined,
  };
  const viewPassNow = (): ViewPass | undefined => {
    const view = filter.activeView();
    if (view === null || viewPassOf === undefined) return undefined;
    const revision = filter.viewRevision();
    if (passFor.view?.kind !== view.kind || passFor.view.key !== view.key || passFor.revision !== revision)
      passFor = { view, revision, pass: viewPassOf(view) };
    return passFor.pass;
  };
  const visible = (id: FeatureId): boolean => {
    const s = lookup(id);
    if (s === undefined) return true; // not on the device (yet): the source decides
    const pass = viewPassNow();
    if (pass !== undefined) return pass(s);
    const key = stageKeys.get(s.type);
    const stage = key === undefined ? undefined : s.properties[key];
    return isVisible(filter.state(), s.type, typeof stage === 'string' ? stage : undefined);
  };
  return visible;
}

export function filteredSource(
  source: FeatureSource,
  lookup: (id: FeatureId) => FeatureState | undefined,
  config: CompiledConfig,
  filter: FilterController,
  viewPassOf?: ViewPassOf,
  /** A child at its parent that the family stack hides (B-019): the parent shows, or a sibling anchors the stack. */
  stackedAway: (id: FeatureId) => boolean = () => false,
  /** The open children of a parent that are shown: the badge counts these, not every open child (B-019). */
  openShown?: (id: FeatureId) => number,
): FeatureSource {
  const passes = visibleOf(lookup, config, filter, viewPassOf);
  const visible = (id: FeatureId): boolean => passes(id) && !stackedAway(id);
  /** The feature with its badge counting only the shown children (none when no child is shown). */
  const badgeOf = (f: MapFeature): number | undefined => {
    const base = f.properties[FAMILY_OPEN_KEY];
    return typeof base === 'number' && openShown !== undefined ? openShown(f.id) : undefined;
  };
  const withBadge = (f: MapFeature, n: number | undefined): MapFeature => {
    if (n === undefined || n === f.properties[FAMILY_OPEN_KEY]) return f;
    const rest = Object.fromEntries(Object.entries(f.properties).filter(([k]) => k !== FAMILY_OPEN_KEY));
    return { ...f, properties: n > 0 ? { ...rest, [FAMILY_OPEN_KEY]: n } : rest };
  };
  const decorate = (f: MapFeature): MapFeature => withBadge(f, badgeOf(f));
  return {
    query: (bbox) =>
      source
        .query(bbox)
        .filter((f) => visible(f.id))
        .map(decorate),
    *queryChunks(bbox, size) {
      for (const slice of source.queryChunks(bbox, size))
        yield slice.filter((f) => visible(f.id)).map(decorate);
    },
    subscribe(bbox: Bbox, listener) {
      const shown = new Set<FeatureId>();
      /** The shown parents that carry a badge, with the undecorated feature and the count last sent. */
      const badged = new Map<FeatureId, { readonly base: MapFeature; sent: number }>();
      const inner = source.subscribe(bbox, (c) => {
        const add: MapFeature[] = [];
        const update: MapFeature[] = [];
        const remove: FeatureId[] = [];
        for (const f of [...c.add, ...c.update]) {
          if (visible(f.id)) (shown.has(f.id) ? update : add).push(f);
          else if (shown.delete(f.id)) remove.push(f.id);
        }
        for (const id of c.remove) if (shown.delete(id)) remove.push(id);
        for (const f of add) shown.add(f.id);
        for (const id of remove) badged.delete(id);
        const out = (list: MapFeature[]): MapFeature[] =>
          list.map((f) => {
            const n = badgeOf(f);
            if (n === undefined) badged.delete(f.id);
            else badged.set(f.id, { base: f, sent: n });
            return withBadge(f, n);
          });
        const addOut = out(add);
        const updateOut = out(update);
        if (add.length + update.length + remove.length > 0)
          listener({ add: addOut, update: updateOut, remove });
      });
      /**
       * The filter changed: what is shown is walked again in slices (WP-848), so a 60k map never runs one long task.
       * First what is no longer visible (slices of `shown`), then what became visible (slices of the source's walk), one
       * event per slice. The first slice runs at once; a newer filter change, or `unsubscribe`, ends the older walk.
       */
      let generation = 0;
      let closed = false;
      const yieldNow = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
      const reapply = async (): Promise<void> => {
        const mine = ++generation;
        const ids = [...shown];
        for (let at = 0; at < ids.length; at += PASS_SLICE) {
          if (at > 0) {
            await yieldNow();
            if (closed || mine !== generation) return;
          }
          const remove = ids.slice(at, at + PASS_SLICE).filter((id) => shown.has(id) && !visible(id));
          for (const id of remove) shown.delete(id);
          for (const id of remove) badged.delete(id);
          if (remove.length > 0) listener({ add: [], update: [], remove } satisfies FeatureChange);
        }
        // a switch changes how many children a shown parent counts: its badge follows (B-019)
        const recount: MapFeature[] = [];
        for (const [id, entry] of badged) {
          const n = openShown?.(id);
          if (n === undefined || n === entry.sent) continue;
          entry.sent = n;
          recount.push(withBadge(entry.base, n));
        }
        if (recount.length > 0) listener({ add: [], update: recount, remove: [] } satisfies FeatureChange);
        const slices = source.queryChunks(bbox, PASS_SLICE);
        for (let n = slices.next(); n.done !== true; n = slices.next()) {
          const add = n.value.filter((f) => visible(f.id) && !shown.has(f.id));
          for (const f of add) {
            shown.add(f.id);
            const count = badgeOf(f);
            if (count !== undefined) badged.set(f.id, { base: f, sent: count });
          }
          if (add.length > 0)
            listener({ add: add.map(decorate), update: [], remove: [] } satisfies FeatureChange);
          await yieldNow();
          if (closed || mine !== generation) return;
        }
      };
      const stopFilter = filter.subscribe(() => void reapply());
      return () => {
        closed = true;
        stopFilter();
        inner();
      };
    },
  };
}
