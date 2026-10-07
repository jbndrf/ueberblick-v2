// The renderer's hold on the project's basemaps (WP-621): remembers the latest choice, registers the pmtiles protocol
// before the first pmtiles layer draws, and moves the live map to the choice one run at a time.
import type { MapConfig } from '@ueberblick/core/model';
import type { MapSelection } from '@ueberblick/core/registry';
import type { MaplibreApi, MlMap } from './api';
import type { PackRouting, TileProxy } from './packs-types';
import { applyBasemaps, resolveSelection } from './basemaps';

/** The `pmtiles` library's protocol object: `tile` is the handler MapLibre calls for `pmtiles://` URLs. */
export interface PmtilesProtocol {
  readonly tile: unknown;
}

/** The library loads on the first pmtiles layer only, so a project without one never fetches it (R14). */
const loadPmtilesLibrary = async (): Promise<PmtilesProtocol> => new (await import('pmtiles')).Protocol();

/** Protocol registrations are global to the MapLibre library: one per `addProtocol`, however many maps there are. */
const registered = new WeakMap<object, Promise<void>>();

const packRegistered = new WeakMap<object, Promise<void>>();

const noop = (): void => undefined;

export interface BasemapSyncDeps {
  readonly loadPmtiles: (() => Promise<PmtilesProtocol>) | undefined;
  readonly addProtocol: ((name: string, handler: unknown) => void) | undefined;
  /** The offline-pack tile protocol (WP-662), registered through the same `addProtocol` as pmtiles, once per library. */
  readonly packProtocol?: PackRouting | undefined;
  /** The project's tile proxy: proxied layers are read from it (A-033). */
  readonly proxy?: TileProxy | undefined;
  readonly map: () => MlMap | undefined;
  readonly api: () => MaplibreApi | undefined;
  readonly destroyed: () => boolean;
  /** The id of the lowest feature layer; basemaps are drawn below it. */
  readonly lowestViewLayer: () => string | undefined;
}

export interface BasemapSync {
  /** The latest choice; drawn by the next `sync`. */
  want(config: MapConfig, selection: MapSelection): void;
  /** Brings the map to the latest choice; runs queue behind each other, a failed one does not stop the next. */
  sync(): Promise<void>;
}

export function createBasemapSync(deps: BasemapSyncDeps): BasemapSync {
  let wanted: { config: MapConfig; selection: MapSelection } | undefined;
  let shown: { config: MapConfig; selection: MapSelection } | undefined;
  let job: Promise<void> = Promise.resolve();

  const ensurePmtiles = (config: MapConfig, selection: MapSelection): Promise<void> | undefined => {
    const keys = [...(selection.base === undefined ? [] : [selection.base]), ...selection.overlays];
    if (!keys.some((k) => config.layers[k]?.source.type === 'pmtiles')) return undefined;
    const api = deps.api();
    const add = deps.addProtocol ?? api?.addProtocol?.bind(api);
    if (add === undefined) return undefined;
    const key = deps.addProtocol ?? api?.addProtocol ?? add;
    let done = registered.get(key);
    if (done === undefined) {
      done = (deps.loadPmtiles ?? loadPmtilesLibrary)().then((p) => add('pmtiles', p.tile));
      registered.set(key, done);
    }
    return done;
  };

  const ensurePacks = (): Promise<void> | undefined => {
    const p = deps.packProtocol;
    const api = deps.api();
    const add = deps.addProtocol ?? api?.addProtocol?.bind(api);
    if (p === undefined || add === undefined) return undefined;
    const key = deps.addProtocol ?? api?.addProtocol ?? add;
    let done = packRegistered.get(key);
    if (done === undefined) {
      done = Promise.resolve(add(p.name, p.handler));
      packRegistered.set(key, done);
    }
    return done;
  };

  const run = async (): Promise<void> => {
    const target = wanted;
    const m = deps.map();
    if (target === undefined || m === undefined || deps.destroyed()) return;
    const next = resolveSelection(target.config, target.selection);
    await ensurePmtiles(target.config, next);
    await ensurePacks();
    if (deps.destroyed() || deps.map() !== m) return;
    const before = deps.lowestViewLayer();
    if (shown !== undefined && shown.config !== target.config)
      applyBasemaps(
        m,
        shown.config,
        shown.selection,
        { base: undefined, overlays: [] },
        before,
        deps.packProtocol,
        deps.proxy,
      );
    const prev = shown?.config === target.config ? shown.selection : undefined;
    applyBasemaps(m, target.config, prev, next, before, deps.packProtocol, deps.proxy);
    shown = { config: target.config, selection: next };
  };

  return {
    want(config, selection) {
      wanted = { config, selection };
    },
    sync: () => (job = job.catch(noop).then(run)),
  };
}
