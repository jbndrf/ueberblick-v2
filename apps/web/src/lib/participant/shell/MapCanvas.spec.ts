// @vitest-environment jsdom
// The map canvas (v3 `MapCanvas.svelte`): it draws the view, forwards a tap on a feature, names itself, keeps the
// settled-camera seam the e2e reads (WP-585) and, when no map can be drawn, says so and lists the features instead.
// v3 had no zoom buttons: none is drawn. The List toggle (keyboard and screen-reader way to a feature) is kept.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Ui from '@ueberblick/ui';
import type * as Filtered from '../sheets/filter/filtered-source';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import type { MapHandle } from '@ueberblick/ui';
import type { Device } from '../device';
import { createFilterController } from '../sheets/filter/filter-controller';
import { createLayerController, participantMap } from '../sheets/layer/layer-controller';
import { memoryChoice } from '../sheets/layer/layer-prefs.testing';
import type { MapConfig } from '@ueberblick/core/model';
import type { Prefs } from '@ueberblick/core/prefs';

vi.mock('maplibre-gl', () => ({ setWorkerUrl: () => undefined }));
const state = vi.hoisted(() => ({
  listeners: [] as ((e: readonly number[]) => void)[],
  taps: [] as ((id: string) => void)[],
  current: [7, 50, 8, 51] as readonly number[],
  readyFails: false,
  basemaps: [] as unknown[][],
  zoom: [] as unknown[],
  mounted: [] as { camera?: unknown }[],
  selected: [] as unknown[],
}));
const spy = vi.hoisted(() => ({
  rows: 0,
  rowsOf: [] as unknown[][],
  visibleOf: 0,
  list: [] as { id: string; name: string; properties: object }[],
  rings: [] as ((c: unknown) => void)[],
}));
vi.mock('../sheets/filter/filtered-source', async (importOriginal) => {
  const real = await importOriginal<typeof Filtered>();
  return {
    ...real,
    visibleOf: (...a: Parameters<typeof real.visibleOf>) => (spy.visibleOf++, real.visibleOf(...a)),
  };
});
vi.mock('@ueberblick/ui', async (importOriginal) => {
  const real = await importOriginal<typeof Ui>();
  const handle = {
    get ready() {
      return state.readyFails ? Promise.reject(new Error('no webgl')) : Promise.resolve();
    },
    onFeatureTap: (l: (id: string) => void) => {
      state.taps.push(l);
      return () => undefined;
    },
    onExtentChange: (l: (e: readonly number[]) => void) => {
      state.listeners.push(l);
      return () => undefined;
    },
    extent: () => state.current,
    setBasemaps: (...a: unknown[]) => void state.basemaps.push(a),
    setZoomBounds: (b: unknown) => void state.zoom.push(b),
    setSelected: (s: unknown) => void state.selected.push(s),
    destroy: () => undefined,
  };
  return {
    ...real,
    createRendererMap: () =>
      new Map([
        [
          'maplibre-2d',
          { mount: (_el: unknown, v: { camera?: unknown }) => (state.mounted.push(v), handle) },
        ],
      ]),
  };
});

const { default: MapCanvas } = await import('./MapCanvas.svelte');

const report = vi.fn();
const fileOf = (layers: unknown) => ({
  types: { baum: { geometry: 'geometrie', properties: {} } },
  views: { karte: { source: { type: 'baum' }, layers } },
});
const deviceOf = (layers: unknown = { l: { renderer: 'maplibre-2d', style: { layers: [] } } }): Device =>
  ({
    get classified() {
      return (this as { config: never }).config;
    },
    config: { file: fileOf(layers) },
    viewSource: () => ({ query: () => [], subscribe: () => () => undefined }),
    viewList: () => ({
      rowChunks: function* () {
        spy.rows++;
        yield spy.list;
      },
      rowsOf: (ids: Iterable<unknown>) => (spy.rowsOf.push([...ids]), []),
      rename: (rows: readonly unknown[]) => rows,
    }),
    changed: {
      subscribe: (fn: (c: unknown) => void) => {
        spy.rings.push(fn);
        return () => undefined;
      },
    },
    feature: () => undefined,
    problems: { report },
  }) as unknown as Device;

const props = (over: Record<string, unknown> = {}) => ({
  device: deviceOf(),
  filter: createFilterController(),
  layers: createLayerController({ map: undefined, store: memoryChoice() }),
  record: {
    current: (): Prefs => ({
      tools: {},
      tool_prefs: {},
      filters: { saved: [], active: null, hidden: null },
      ui: {},
    }),
  },
  viewKey: 'karte',
  locale: 'en' as const,
  onfeature: () => undefined,
  theme: 'normal' as const,
  onhandle: () => undefined,
  ...over,
});

afterEach(() => {
  cleanup();
  state.listeners.length = 0;
  state.taps.length = 0;
  state.current = [7, 50, 8, 51];
  state.readyFails = false;
  state.basemaps.length = 0;
  state.zoom.length = 0;
  state.mounted.length = 0;
  state.selected.length = 0;
  report.mockClear();
  spy.rows = 0;
  spy.rowsOf.length = 0;
  spy.visibleOf = 0;
  spy.list = [];
  spy.rings.length = 0;
});

const basemapConfig = {
  layers: {
    osm: { label: 'S', kind: 'base', source: { type: 'preset', preset: 'osm' }, on_at_start: true },
    luft: { label: 'L', kind: 'base', source: { type: 'xyz', url: 'https://t/{z}/{x}/{y}.jpg' } },
    intern: { label: 'I', kind: 'overlay', roles: ['kontrolle'], source: { type: 'geojson', url: '/i' } },
  },
} as unknown as MapConfig;

describe('MapCanvas: the open feature is marked (WP-733)', () => {
  it('marks the selected feature with the theme colour, moves the mark, and clears it when none is open', async () => {
    const { rerender } = render(MapCanvas, props({ selected: 'f-1' }));
    await waitFor(() => expect(state.selected.at(-1)).toEqual({ id: 'f-1', color: '#0b57d0' }));
    await rerender(props({ selected: 'f-2' }));
    await waitFor(() => expect(state.selected.at(-1)).toEqual({ id: 'f-2', color: '#0b57d0' }));
    await rerender(props({ selected: null }));
    await waitFor(() => expect(state.selected.at(-1)).toBeNull());
  });

  it('says which feature is marked on the map element, for the e2e', async () => {
    render(MapCanvas, props({ selected: 'f-9' }));
    expect((await screen.findByTestId('map')).dataset['selected']).toBe('f-9');
  });
});

describe('MapCanvas: offline packs (WP-650)', () => {
  it('applies the basemaps again with a new config object when the packs on the device change', async () => {
    let ring: () => void = () => undefined;
    render(MapCanvas, props({ onPacksChange: (run: () => void) => ((ring = run), () => undefined) }));
    await waitFor(() => expect(state.basemaps.length).toBe(1));
    const first = state.basemaps[0] as [MapConfig, unknown];
    ring();
    expect(state.basemaps).toHaveLength(2);
    const again = state.basemaps[1] as [MapConfig, unknown];
    expect(again[0]).not.toBe(first[0]);
    expect(again[0]).toEqual(first[0]);
    expect(again[1]).toEqual(first[1]);
  });
});

describe('MapCanvas: Kartenlayer (WP-621)', () => {
  it('hands the renderer the layers of the roles and the start selection, then each change of the choice', async () => {
    const layers = createLayerController({
      map: participantMap(basemapConfig, ['buerger']),
      store: memoryChoice(),
    });
    render(MapCanvas, props({ layers }));
    await waitFor(() => expect(state.basemaps.length).toBe(1));
    const [config, selection] = state.basemaps[0] as [MapConfig, unknown];
    expect(Object.keys(config.layers)).toEqual(['osm', 'luft']);
    expect(selection).toEqual({ base: 'osm', overlays: [] });
    layers.setBase('luft');
    expect(state.basemaps.at(-1)?.[1]).toEqual({ base: 'luft', overlays: [] });
  });

  it('draws the OpenStreetMap base, as v3, for a project without a map section', async () => {
    render(MapCanvas, props());
    await waitFor(() => expect(state.basemaps.length).toBe(1));
    const [config, selection] = state.basemaps[0] as [MapConfig, { base: string }];
    expect(Object.keys(config.layers)).toEqual(['default-osm']);
    expect(selection.base).toBe('default-osm');
  });
});

describe('MapCanvas', () => {
  it('names the map region; the only button is the List toggle, there are no zoom buttons', async () => {
    render(MapCanvas, props());
    expect(await screen.findByRole('region', { name: 'Map' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['List']);
  });

  it('the List toggle is opaque in dark mode: a translucent fill over the light map left it unreadable (WP-716)', async () => {
    render(MapCanvas, props());
    await screen.findByRole('region', { name: 'Map' });
    expect(screen.getByRole('button', { name: 'List' }).className).toContain('dark:bg-background');
  });

  it('the List toggle swaps map and list and tells the screen, so map-only tools are not offered', async () => {
    const lists: boolean[] = [];
    render(MapCanvas, props({ onlist: (s: boolean) => void lists.push(s) }));
    await screen.findByRole('region', { name: 'Map' });
    await fireEvent.click(screen.getByRole('button', { name: 'List', pressed: false }));
    await waitFor(() => expect(lists).toEqual([true]));
    expect(screen.getByText('No features in this extent.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'List', pressed: true }));
    await waitFor(() => expect(lists).toEqual([true, false]));
  });

  it('a tap on a feature is forwarded with its id', async () => {
    const onfeature = vi.fn();
    render(MapCanvas, props({ onfeature }));
    await waitFor(() => expect(state.taps.length).toBe(1));
    state.taps[0]?.('f-1');
    expect(onfeature).toHaveBeenCalledWith('f-1');
  });

  it('writes data-center with data-idle when ready and on every moveend (the e2e seam)', async () => {
    render(MapCanvas, props());
    const map = screen.getByTestId('map');
    await waitFor(() => expect(map.hasAttribute('data-idle')).toBe(true));
    expect(map.getAttribute('data-center')).toBe('7.5,50.5');
    state.current = [7, 51, 9, 53];
    for (const l of state.listeners) l(state.current);
    expect(map.getAttribute('data-center')).toBe('8,52');
  });

  it('a map that fails to load takes its handle away, reports it and lists the features instead', async () => {
    state.readyFails = true;
    const seen: (MapHandle | undefined)[] = [];
    const lists: boolean[] = [];
    render(
      MapCanvas,
      props({
        onhandle: (h: MapHandle | undefined) => void seen.push(h),
        onlist: (s: boolean) => void lists.push(s),
      }),
    );
    await screen.findByText('The map could not load. The list shows the same features.');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'map_unavailable' }));
    expect(seen[0]).toBeDefined();
    expect(seen.at(-1)).toBeUndefined();
    expect(lists).toContain(true);
    expect(screen.getByText('No features in this extent.')).toBeTruthy();
  });

  it('a view with no drawable layer shows the list at once and reports each unresolved style', async () => {
    const onlist = vi.fn();
    render(MapCanvas, props({ device: deviceOf({ l: { style: { $ref: 'styles/a.json' } } }), onlist }));
    await waitFor(() => expect(onlist).toHaveBeenCalledWith(true));
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'style_unresolved', subject: 'l' }));
  });
});

describe('MapCanvas: the project zoom limits (A-036, v3 Projekteinstellungen)', () => {
  const withMap = (map: unknown): Device => {
    const d = deviceOf();
    return { ...d, config: { file: { ...d.config.file, map } } } as unknown as Device;
  };
  it('hands the renderer map.min_zoom and map.max_zoom', async () => {
    render(MapCanvas, props({ device: withMap({ min_zoom: 4, max_zoom: 17 }) }));
    await waitFor(() => expect(state.zoom).toEqual([{ min: 4, max: 17 }]));
  });
  it('hands only the limit that is set; none when the project has none', async () => {
    render(MapCanvas, props({ device: withMap({ max_zoom: 12 }) }));
    await waitFor(() => expect(state.zoom).toEqual([{ max: 12 }]));
    cleanup();
    state.zoom.length = 0;
    render(MapCanvas, props());
    await waitFor(() => expect(state.zoom).toEqual([{}]));
  });
});

describe('MapCanvas: where the map opens (WP-692, v3 +page.svelte:646-666)', () => {
  const withMap = (map: unknown, camera?: object): Device => {
    const d = deviceOf();
    const file = d.config.file as unknown as { views: Record<string, object>; map?: unknown };
    file.map = map;
    if (camera !== undefined) file.views.karte = { ...file.views.karte, camera };
    return d;
  };
  const opened = async () => {
    await waitFor(() => expect(state.mounted).toHaveLength(1));
    return state.mounted[0]?.camera;
  };
  it('a view without a camera opens at map.start (centre and zoom)', async () => {
    render(MapCanvas, props({ device: withMap({ start: { center: [9, 48], zoom: 8 } }) }));
    expect(await opened()).toEqual({ center: [9, 48], zoom: 8 });
  });
  it('a view camera wins over map.start', async () => {
    const camera = { center: [7, 50], zoom: 12 };
    render(MapCanvas, props({ device: withMap({ start: { center: [9, 48], zoom: 8 } }, camera) }));
    expect(await opened()).toEqual(camera);
  });
  it('without a start the view has no camera, so the renderer fits to the features', async () => {
    render(MapCanvas, props({ device: withMap({}) }));
    expect(await opened()).toBeUndefined();
  });
  it('without a start, a view whose type has no geometry opens at v3 default camera (WP-731)', async () => {
    const d = withMap({});
    (d.config.file as unknown as { types: Record<string, object> }).types.baum = { properties: {} };
    render(MapCanvas, props({ device: d }));
    expect(await opened()).toEqual({ center: [7.45, 51.505], zoom: 13 });
  });
});

describe('MapCanvas: the Liste is read only when shown (WP-800)', () => {
  it('does no work on a pan or a change while hidden, reads once when shown, and then only the named ids', async () => {
    render(MapCanvas, props());
    await waitFor(() => expect(state.listeners.length).toBeGreaterThan(0));
    for (const l of state.listeners) l([7, 50, 8, 51]); // a pan
    for (const ring of spy.rings) ring('all'); // a change burst
    for (const ring of spy.rings) ring(new Set(['f1']));
    expect(spy.rows).toBe(0);
    expect(spy.rowsOf).toHaveLength(0);

    await fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    expect(spy.rows).toBe(1);
    await new Promise((r) => setTimeout(r, 20)); // the chunked read finishes

    for (const ring of spy.rings) ring(new Set(['f1']));
    for (const ring of spy.rings) ring(new Set()); // a queue change that moved nothing
    expect(spy.rowsOf).toEqual([['f1']]);
    expect(spy.rows).toBe(1);
    for (const ring of spy.rings) ring('all');
    expect(spy.rows).toBe(2);
  });

  it('builds its filter predicate once, not per refresh', async () => {
    spy.list = [{ id: 'f1', name: 'Eiche', properties: {} }];
    render(MapCanvas, props());
    await fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    for (let i = 0; i < 3; i++) for (const ring of spy.rings) ring('all');
    expect(spy.visibleOf).toBe(1);
  });
});
