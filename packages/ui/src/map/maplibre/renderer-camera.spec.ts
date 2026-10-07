import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { View } from '@ueberblick/core/model';
import { pointFeature } from '../test-helpers';
import { FIT_SETTLE_MS } from './start-fit';
import { mount, styled, tick, view } from './renderer-fixture';

const withCamera = (camera: object): View => ({ camera }) as unknown as View;
const jump = { reducedMotion: () => true };
const settle = (): Promise<unknown> => new Promise((r) => setTimeout(r, FIT_SETTLE_MS + 50));

describe('maplibre-2d renderer: the view camera', () => {
  it('mounts at the view camera', async () => {
    const { handle, calls } = mount(
      undefined,
      withCamera({ center: [7.1, 50.7], zoom: 15, bearing: 20, pitch: 40 }),
    );
    await handle.ready;
    expect(calls.options).toMatchObject({ center: [7.1, 50.7], zoom: 15, bearing: 20, pitch: 40 });
    expect(calls.fitted).toEqual([]); // a camera wins over the data extent
  });

  it('derives the zoom from Z', async () => {
    const { handle, calls } = mount(undefined, withCamera({ center: [0, 0, 14_677.3] }));
    await handle.ready;
    expect(calls.options?.zoom).toBeCloseTo(12, 2);
  });

  it('a camera with neither zoom nor Z opens at town level', async () => {
    const { handle, calls } = mount(undefined, withCamera({ center: [7.1, 50.7] }));
    await handle.ready;
    expect(calls.options).toMatchObject({ center: [7.1, 50.7], zoom: 14 });
  });

  it('with no camera it fits the extent of the features it knows', async () => {
    const { handle, calls } = mount();
    await handle.ready;
    await tick();
    expect(calls.fitted).toHaveLength(1);
    expect(calls.fitted[0]).toMatchObject({
      b: [
        [1.5, 1],
        [9, 51],
      ],
    });
  });

  it('with no camera and no features it keeps the default', async () => {
    const { handle, calls } = mount([]);
    await handle.ready;
    await tick();
    expect(calls.fitted).toEqual([]);
    expect(calls.options).toMatchObject({ center: [10, 51], zoom: 5 });
  });

  it('switching to a view with another camera applies it; the same camera or none leaves the map', async () => {
    const { handle, calls } = mount(undefined, withCamera({ center: [7, 50], zoom: 10 }), jump);
    await handle.ready;
    handle.setView(withCamera({ center: [7, 50], zoom: 10 }));
    handle.setView({} as View);
    expect(calls.eased).toEqual([]);
    handle.setView(withCamera({ center: [8.5, 49], zoom: 12, bearing: 90 }));
    expect(calls.eased).toEqual([{ center: [8.5, 49], zoom: 12, bearing: 90, duration: 0 }]);
    handle.setView(withCamera({ center: [7, 50], zoom: 10 }));
    expect(calls.eased).toHaveLength(2); // and back again
  });

  it('a camera set while the map loads is the one it opens with', async () => {
    const { handle, calls } = mount(undefined, {} as View);
    handle.setView(withCamera({ center: [2, 3], zoom: 7 }));
    await handle.ready;
    expect(calls.options).toMatchObject({ center: [2, 3], zoom: 7 });
  });
});

// Without a camera the map fits the extent of the first features the view delivers: one pass over the
// delivery, once per view, never a second full scan of the source (R14).
describe('maplibre-2d renderer: the fit without a camera', () => {
  it('fits the first delivery; a delivery after the fit settled does not refit', async () => {
    const { handle, calls, source } = mount([pointFeature('a', 2, 48), pointFeature('b', 3, 49)]);
    await handle.ready;
    expect(calls.fitted).toHaveLength(1);
    expect(calls.fitted[0]).toMatchObject({
      b: [
        [2, 48],
        [3, 49],
      ],
    });
    await settle(); // the fit settles (WP-850)
    source.emit({ add: [pointFeature('c', 10, 52)] });
    await tick();
    expect(calls.fitted).toHaveLength(1);
  }, 15_000);

  it('an empty first delivery does not fit; the first non-empty one does', async () => {
    const { handle, calls, source } = mount([]);
    await handle.ready;
    await tick();
    expect(calls.fitted).toEqual([]);
    source.emit({ add: [pointFeature('a', 7, 50)] });
    await tick();
    expect(calls.fitted).toHaveLength(1);
    expect(calls.fitted[0]).toMatchObject({
      b: [
        [7, 50],
        [7, 50],
      ],
    });
  });

  it('a view with a camera never fits', async () => {
    const { handle, calls, source } = mount(
      [pointFeature('a', 7, 50)],
      withCamera({ center: [7.4, 50.4], zoom: 12 }),
    );
    await handle.ready;
    await tick();
    source.emit({ add: [pointFeature('b', 8, 51)] });
    await tick();
    expect(calls.fitted).toEqual([]);
  });

  it('a 200k-feature delivery fits in one pass, without overflowing the argument stack', async () => {
    const many = Array.from({ length: 200_000 }, (_, i) =>
      pointFeature(`f${i}`, -100 + (i % 200), -40 + (i % 1000) / 100),
    );
    const { handle, calls } = mount(many);
    await handle.ready;
    await tick();
    expect(calls.fitted).toHaveLength(1);
    expect(calls.fitted[0]).toMatchObject({
      b: [
        [-100, -40],
        [99, -40 + 999 / 100],
      ],
    });
  });

  it('a camera view stops the fit; a no-camera view fits again on the next delivery', async () => {
    const { handle, calls, source } = mount([pointFeature('a', 7, 50)], view, jump);
    await handle.ready;
    await tick();
    expect(calls.fitted).toHaveLength(1);
    handle.setView(withCamera({ center: [7, 50], zoom: 10 }));
    source.emit({ add: [pointFeature('b', 8, 51)] });
    await tick();
    expect(calls.fitted).toHaveLength(1);
    handle.setView(styled);
    source.emit({ add: [pointFeature('c', 3, 48)] });
    await tick();
    expect(calls.fitted).toHaveLength(2);
    expect(calls.fitted[1]).toMatchObject({
      b: [
        [3, 48],
        [3, 48],
      ],
    });
  });

  it('an all-NaN delivery does not fit; a later valid one does', async () => {
    const { handle, calls, source } = mount([]);
    await handle.ready;
    source.emit({ add: [pointFeature('n', Number.NaN, Number.NaN), pointFeature('i', Infinity, -Infinity)] });
    await tick();
    expect(calls.fitted).toEqual([]);
    source.emit({ add: [pointFeature('a', 7, 50)] });
    await tick();
    expect(calls.fitted).toHaveLength(1);
  });

  it('a mixed delivery fits to the finite anchors only', async () => {
    const { handle, calls } = mount([
      pointFeature('n', Number.NaN, 3),
      pointFeature('a', 2, 48),
      pointFeature('i', Infinity, 60),
      pointFeature('b', 3, 49),
    ]);
    await handle.ready;
    await tick();
    expect(calls.fitted).toHaveLength(1);
    expect(calls.fitted[0]).toMatchObject({
      b: [
        [2, 48],
        [3, 49],
      ],
    });
  });

  it('the fit uses the delivery, never a source query', async () => {
    const { handle, calls, source } = mount([pointFeature('a', 7, 50), pointFeature('b', 8, 51)]);
    const query = source.query.bind(source);
    let queries = 0;
    source.query = (bbox) => {
      queries += 1;
      return query(bbox);
    };
    await handle.ready;
    await tick();
    expect(calls.fitted).toHaveLength(1);
    expect(queries).toBe(0);
  });
});

describe('the lazy MapLibre chunk', () => {
  it('imports the MapLibre stylesheet, so it ships with the chunk and not with the shell', () => {
    const source = readFileSync(new URL('./renderer.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/^import 'maplibre-gl\/dist\/maplibre-gl\.css';$/m);
  });
});

describe('maplibre-2d renderer: the start fit over a sliced delivery (WP-850)', () => {
  const userMove = (calls: { handlers: Map<string, unknown> }): void =>
    (calls.handlers.get('movestart') as (e: { originalEvent?: unknown }) => void)({ originalEvent: {} });

  it('covers the whole view: a later slice outside the first slice refits to the union', async () => {
    const { handle, calls, source } = mount([pointFeature('a', 7, 50)]);
    await handle.ready;
    await tick();
    source.emit({ add: [pointFeature('far', 7.5, 50.4)] });
    await tick();
    expect(calls.fitted.at(-1)).toMatchObject({
      b: [
        [7, 50],
        [7.5, 50.4],
      ],
    });
  });

  it('a person moving the map before the last slice is not overridden', async () => {
    const { handle, calls, source } = mount([pointFeature('a', 7, 50)]);
    await handle.ready;
    await tick();
    const before = calls.fitted.length;
    userMove(calls);
    source.emit({ add: [pointFeature('far', 7.5, 50.4)] });
    await tick();
    expect(calls.fitted).toHaveLength(before);
  });

  it('a later change after the fit settled does not refit', async () => {
    const { handle, calls, source } = mount([pointFeature('a', 7, 50)]);
    await handle.ready;
    await tick();
    await settle();
    const before = calls.fitted.length;
    source.emit({ add: [pointFeature('far', 9, 52)] });
    await tick();
    expect(calls.fitted).toHaveLength(before);
  }, 15_000);

  it('a delivery inside the fitted extent (a filter change) does not move the map', async () => {
    const { handle, calls, source } = mount([pointFeature('a', 7, 50), pointFeature('b', 8, 51)]);
    await handle.ready;
    await tick();
    const before = calls.fitted.length;
    source.emit({ add: [pointFeature('c', 7.5, 50.5)] });
    await tick();
    expect(calls.fitted).toHaveLength(before);
  });
});
