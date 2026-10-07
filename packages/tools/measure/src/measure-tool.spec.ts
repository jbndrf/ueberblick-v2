// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { createGeo, type Geometry, type Position } from '@ueberblick/core/geo';
import { createToolHost } from '@ueberblick/ui';
import { describeToolContract, testMap, testPorts } from '@ueberblick/ui/tool-testing';
import { createMeasureTool } from './measure-tool';
import { measure } from './model';

const geo = createGeo();
const P: Position[] = [
  [9.0, 48.0],
  [9.0013, 48.0],
  [9.0013, 48.0009],
  [9.0, 48.0009],
];

function must<T>(v: T | null | undefined): T {
  if (v === null || v === undefined) throw new Error('expected a value');
  return v;
}

type Locate = () => Promise<{ readonly lon: number; readonly lat: number }>;

function setup(opts: { locale?: string; locate?: Locate } = {}) {
  const queue: Position[] = [];
  const showOverlay = vi.fn<(g: Geometry) => void>();
  const clearOverlay = vi.fn();
  const map = Object.assign(testMap(), { showOverlay, clearOverlay });
  const locate: Locate =
    opts.locate ??
    (async () => {
      const [lon, lat] = must(queue.shift());
      return { lon: must(lon), lat: must(lat) };
    });
  const host = createToolHost({
    loaders: { measure: async () => createMeasureTool({ geo }) },
    ports: testPorts({ position: { current: locate } }),
    ...(opts.locale ? { locale: opts.locale } : {}),
  });
  const root = document.createElement('div');
  document.body.append(root);
  const mounted = host.mountPanel(root, {
    point: 'tools-sheet',
    toolKey: 'measure',
    startTask: vi.fn(),
    map,
    openFeature: vi.fn(),
    searchText: () => [],
    feature: () => undefined,
    typeLabel: (k) => k,
  });
  const button = (name: RegExp) =>
    must(Array.from(root.querySelectorAll('button')).find((b) => name.test(b.textContent ?? '')));
  const text = () => root.textContent ?? '';
  /** One "Add my position" tap per point, each waiting until the panel has drawn it. */
  const walk = async (points: Position[]) => {
    for (const p of points) {
      queue.push(p);
      const before = showOverlay.mock.calls.length;
      button(/Add my position/).click();
      await vi.waitFor(() => expect(showOverlay.mock.calls.length).toBeGreaterThan(before));
    }
  };
  return { root, mounted, walk, button, text, showOverlay, clearOverlay, map };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('measure tool', () => {
  it('shows a distance that equals core.geo for the added points, and an overlay line', async () => {
    const t = setup();
    await t.mounted;
    expect(t.text()).toContain('Walk to each point');
    await t.walk(P.slice(0, 3));
    const r = measure(geo, 'distance', P.slice(0, 3));
    if (r.state !== 'ok' || r.mode !== 'distance') throw new Error('fixture');
    expect(t.text()).toContain(`Total: ${r.lengthM.toFixed(1)} m`);
    expect(t.showOverlay).toHaveBeenLastCalledWith({ type: 'LineString', coordinates: P.slice(0, 3) });
  });

  it('measures an area in the area mode', async () => {
    const t = setup();
    await t.mounted;
    t.button(/^Area$/).click();
    await t.walk(P);
    expect(t.text()).toMatch(/Area: \d[\d,]* m²/);
    expect(t.text()).toContain('Perimeter:');
    expect(t.showOverlay).toHaveBeenLastCalledWith({ type: 'Polygon', coordinates: [[...P, P[0]]] });
  });

  it('undo removes the last point, clear removes all and clears the overlay', async () => {
    const t = setup();
    await t.mounted;
    await t.walk(P.slice(0, 3));
    t.button(/^Undo$/).click();
    expect(t.showOverlay).toHaveBeenLastCalledWith({ type: 'LineString', coordinates: P.slice(0, 2) });
    t.button(/^Clear$/).click();
    expect(t.clearOverlay).toHaveBeenCalled();
    expect(t.text()).toContain('Walk to each point');
    expect(t.button(/^Clear$/).disabled).toBe(true);
  });

  it('a crossing outline is refused with a reason, not measured', async () => {
    const t = setup();
    await t.mounted;
    t.button(/^Area$/).click();
    await t.walk([
      [9, 48],
      [9.001, 48.001],
      [9.001, 48],
      [9, 48.001],
    ]);
    expect(t.text()).toContain('crosses itself');
    expect(t.text()).not.toContain('Area: ');
  });

  it('says when the device cannot locate', async () => {
    const t = setup({
      locate: async () => {
        throw new Error('denied');
      },
    });
    await t.mounted;
    t.button(/Add my position/).click();
    await vi.waitFor(() => expect(t.text()).toContain('Could not get your position'));
  });

  it('speaks German and destroy clears the overlay and removes the DOM', async () => {
    const t = setup({ locale: 'de' });
    const handle = await t.mounted;
    expect(t.text()).toContain('Gehen Sie zu jedem Punkt');
    expect(t.button(/^Strecke$/).getAttribute('aria-pressed')).toBe('true');
    handle.destroy();
    expect(t.clearOverlay).toHaveBeenCalled();
    expect(t.root.querySelector('.ub-measure')).toBeNull();
  });

  it('never writes: the map port offers no way to', async () => {
    const t = setup();
    await t.mounted;
    const port = Object.keys(t.map).filter((k) => k !== 'tap' && k !== 'taps');
    expect(port.sort()).toEqual(['centerOn', 'clearOverlay', 'onTap', 'showOverlay']);
  });

  it('has no accessibility violations', async () => {
    const t = setup();
    await t.mounted;
    await t.walk(P);
    const res = await axe.run(t.root, { rules: { 'color-contrast': { enabled: false } } });
    expect(res.violations.map((v) => v.id)).toEqual([]);
  });
});

describe('measure tool: taps on the map', () => {
  it('a tap on the map adds a point, and unmount stops listening', async () => {
    const t = setup();
    const handle = await t.mounted;
    for (const p of P.slice(0, 2)) t.map.tap(p);
    await vi.waitFor(() => expect(t.text()).toMatch(/Total/));
    const overlay = t.showOverlay.mock.calls.at(-1)?.[0] as Geometry;
    expect(overlay).toEqual({ type: 'LineString', coordinates: P.slice(0, 2) });
    expect(t.map.taps).toBe(1);
    handle.destroy();
    expect(t.map.taps).toBe(0);
  });
});

describeToolContract({
  name: 'measure',
  tool: () => createMeasureTool({ geo }),
  ports: testPorts({ position: { current: async () => ({ lon: 9, lat: 48 }) } }),
  drive: async (root) => {
    Array.from(root.querySelectorAll('button'))
      .find((b) => /Add my position/.test(b.textContent ?? ''))
      ?.click();
  },
});
