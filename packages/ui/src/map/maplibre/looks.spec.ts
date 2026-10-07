// WP-674 (B-018): a type's look by value on the map: the plan (images, expressions), the default layers drawn by value,
// the renderer registering images and the worker's classifying property.
import { describe, expect, it } from 'vitest';
import { MARKER_ICONS, DEFAULT_MARKER_COLOR } from '@ueberblick/core/registry';
import { markerLooks, resolveMarker, type MarkerLooks } from '@ueberblick/core/marker';
import { markerSvg } from '../marker-svg';
import { pointFeature } from '../test-helpers';
import { MARKER_ICON_BODIES } from './marker-icon-bodies';
import { planLooks } from './looks';
import { mount, tick } from './renderer-fixture';
import { resolveLayers } from './style';
import { LAYER_IDS } from './layers';

const type = {
  classify: {
    property: 'zustand',
    values: {
      gut: { color: '#16a34a', icon: { key: 'leaf' } },
      schlecht: {
        color: '#dc2626',
        icon: { svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>', size: 40 },
      },
      mittel: { color: '#ca8a04' },
    },
  },
  marker: { color: '#336699', icon: { key: 'map-pin' } },
} as const;
const looks = markerLooks(type as never) as MarkerLooks;

describe('markerSvg', () => {
  it('draws every registry key', () => {
    for (const key of MARKER_ICONS.keys) {
      expect(MARKER_ICON_BODIES[key], key).toBeDefined();
      expect(markerSvg({ color: '#112233', icon: { key }, size: 32 })).toContain('stroke="#112233"');
    }
  });
  it('draws the dot with no icon, and an inline svg at its size', () => {
    expect(markerSvg({ color: '#abcdef', size: 32 })).toContain('fill="#abcdef"');
    const svg = markerSvg({
      color: '#000000',
      icon: { svg: '<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>' },
      size: 40,
    });
    expect(svg).toContain('width="40"');
    expect(svg).toContain('viewBox="0 0 10 10"');
  });
});

describe('planLooks', () => {
  it('matches the value to an image and a colour, with the type marker as the fallback', () => {
    const plan = planLooks(looks);
    const { iconImage, color } = plan as { iconImage: unknown[]; color: unknown[] };
    expect(iconImage.slice(0, 2)).toEqual(['match', ['get', 'zustand']]);
    expect(color).toEqual([
      'match',
      ['get', 'zustand'],
      'gut',
      '#16a34a',
      'schlecht',
      '#dc2626',
      'mittel',
      '#ca8a04',
      '#336699',
    ]);
    const id = (value: string): unknown => iconImage[iconImage.indexOf(value) + 1];
    expect(new Set([id('gut'), id('schlecht'), id('mittel'), iconImage.at(-1)]).size).toBe(4);
    expect(plan.images).toHaveLength(4);
    expect(plan.images.find((i) => i.id === id('schlecht'))?.px).toBe(40);
    expect(plan.images.find((i) => i.id === id('mittel'))?.px).toBe(32);
  });
  it('one image per distinct drawing', () => {
    const same = markerLooks({
      classify: { property: 'p', values: { a: { color: '#111111' }, b: { color: '#111111' } } },
    });
    expect(planLooks(same as MarkerLooks).images).toHaveLength(2); // the a/b dot and the fallback dot
    expect(
      planLooks({ property: undefined, values: {}, fallback: resolveMarker({}, undefined) }).iconImage,
    ).toMatch(/^ub-look-/);
  });
  it('without a classifying property the look is constant', () => {
    const plan = planLooks(markerLooks({ marker: { color: '#445566' } }) as MarkerLooks);
    expect(plan.color).toBe('#445566');
    expect(typeof plan.iconImage).toBe('string');
    expect(markerLooks({})).toBeUndefined();
    expect(resolveMarker({}, undefined).color).toBe(DEFAULT_MARKER_COLOR);
  });
});

describe('resolveLayers with a look plan', () => {
  const find = (layers: ReturnType<typeof resolveLayers>, id: string) =>
    layers.find((l) => (l.spec as { id: string }).id === id)?.spec as {
      type: string;
      layout?: Record<string, unknown>;
      paint?: Record<string, unknown>;
    };
  it('draws singles as a symbol layer and shapes in the value colour; clusters stay as they were', () => {
    const plan = planLooks(looks);
    const layers = resolveLayers({} as never, plan);
    expect(find(layers, LAYER_IDS.single).type).toBe('symbol');
    expect(find(layers, LAYER_IDS.single).layout?.['icon-image']).toEqual(plan.iconImage);
    expect(find(layers, LAYER_IDS.fill).paint?.['fill-color']).toEqual(plan.color);
    expect(find(layers, LAYER_IDS.line).paint?.['line-color']).toEqual(plan.color);
    expect(find(layers, LAYER_IDS.cluster).paint?.['circle-color']).toBe('#1a365d');
  });
  it('a view style that replaces a default keeps its own', () => {
    const view = {
      layers: {
        m: {
          renderer: 'maplibre-2d',
          style: {
            layers: [
              {
                id: LAYER_IDS.single,
                type: 'circle',
                source: 'ub-clusters',
                paint: { 'circle-color': '#000000' },
              },
            ],
          },
        },
      },
    };
    expect(find(resolveLayers(view as never, planLooks(looks)), LAYER_IDS.single).type).toBe('circle');
  });
});

describe('the renderer draws by value', () => {
  it('registers each image once at pixel ratio 2, draws the symbol layer and tells the worker the classifying key', async () => {
    const rasterized: string[] = [];
    const { handle, calls, posted } = mount(
      [pointFeature('p1', 8, 50, { zustand: 'gut' }), pointFeature('p2', 9, 51, { zustand: 'schlecht' })],
      undefined,
      { rasterize: (svg) => (rasterized.push(svg), Promise.resolve({})) },
    );
    handle.setLooks?.(looks);
    await handle.ready;
    await tick();
    expect(calls.images.map((i) => i.id).sort()).toEqual(
      planLooks(looks)
        .images.map((i) => i.id)
        .sort(),
    );
    expect(calls.images.every((i) => i.pixelRatio === 2)).toBe(true);
    expect(rasterized).toHaveLength(4);
    const single = calls.layerSpecs.find((s) => (s as { id: string }).id === LAYER_IDS.single) as {
      type: string;
    };
    expect(single.type).toBe('symbol');
    expect(posted).toContainEqual({ type: 'classify', key: 'zustand' });
    // the worker holds the classifying property for the cluster counts and the layer's own `get`
    expect(posted.some((m) => m.type === 'keys' && m.keys.includes('zustand'))).toBe(true);
  });
  it('a later look redraws the layers without re-sending features, and undefined draws the default again', async () => {
    const { handle, calls, posted } = mount([pointFeature('p1', 8, 50, { zustand: 'gut' })], undefined, {
      rasterize: () => Promise.resolve({}),
    });
    await handle.ready;
    await tick();
    const applies = posted.filter((m) => m.type === 'apply').length;
    handle.setLooks?.(looks);
    await tick();
    await tick();
    expect(calls.images.length).toBeGreaterThan(0);
    expect(posted.filter((m) => m.type === 'apply')).toHaveLength(applies);
    handle.setLooks?.(undefined);
    await tick();
    const last = calls.layerSpecs.filter((s) => (s as { id: string }).id === LAYER_IDS.single).at(-1) as {
      type: string;
    };
    expect(last.type).toBe('circle');
    expect(posted.filter((m) => m.type === 'classify').at(-1)).toEqual({ type: 'classify' });
  });
});

describe('image ids across plans (WP-744)', () => {
  it('a changed look gets a new image id, an unchanged one keeps its id', () => {
    const a = planLooks(markerLooks({ marker: { color: '#112233' } }) as MarkerLooks);
    const b = planLooks(markerLooks({ marker: { color: '#445566' } }) as MarkerLooks);
    const again = planLooks(markerLooks({ marker: { color: '#112233' } }) as MarkerLooks);
    expect(b.images[0]?.id).not.toBe(a.images[0]?.id);
    expect(again.images[0]?.id).toBe(a.images[0]?.id);
  });
});
