import { readFileSync, readdirSync } from 'node:fs';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';
import { describe, expect, it, vi } from 'vitest';
import type { View } from '@ueberblick/core/model';
import { resolveLayers } from './maplibre/style';
import { LAYER_IDS, SOURCES, validateViewStyle } from './view-style';

const stylesDir = new URL('../../../../fixtures/golden/styles/', import.meta.url);
const golden = readdirSync(stylesDir).filter((f) => f.endsWith('.json'));
const load = (f: string): unknown => JSON.parse(readFileSync(new URL(f, stylesDir), 'utf8'));
const viewWith = (style: unknown): View =>
  ({ layers: { main: { renderer: 'maplibre-2d', style } } }) as unknown as View;
const rendererVerdict = (style: unknown): boolean => {
  try {
    resolveLayers(viewWith(style));
    return true;
  } catch {
    return false;
  }
};

const badPaint = { id: 'b', type: 'circle', source: SOURCES.clusters, paint: { 'circle-radius': 'wide' } };
const legacyFilter = ['==', 'art', 'x'];
const broken: Record<string, unknown> = {
  'bad paint value': { layers: [badPaint] },
  'foreign source': { layers: [{ id: 'b', type: 'circle', source: 'elsewhere' }] },
  'layers not a list': { layers: 'x' },
  'legacy filter on an added ub-clusters layer': {
    layers: [
      {
        id: 'legacy',
        type: 'circle',
        source: SOURCES.clusters,
        filter: legacyFilter,
        paint: { 'circle-radius': 4 },
      },
    ],
  },
};

describe('validateViewStyle', () => {
  it('has golden styles to test against', () => expect(golden.length).toBeGreaterThan(0));

  it.each(golden)('golden style %s: valid, same verdict as the renderer', async (f) => {
    const style = load(f);
    expect(await validateViewStyle(style)).toEqual({ ok: true });
    expect(rendererVerdict(style)).toBe(true);
  });

  it.each(Object.keys(broken))('rejects "%s" with a path, like the renderer', async (name) => {
    const result = await validateViewStyle(broken[name]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.path).toMatch(/^layers/);
    expect(result.errors[0]?.message).not.toBe('');
    expect(rendererVerdict(broken[name])).toBe(false);
  });

  it('names the layer index and id of the faulty layer', async () => {
    const style = { layers: [{ id: 'ok', type: 'circle', source: SOURCES.clusters }, badPaint] };
    const result = await validateViewStyle(style);
    expect(result).toMatchObject({ ok: false, errors: [{ path: 'layers[1]', layerId: 'b' }] });
  });

  it('refuses an unresolved $ref', async () => {
    expect((await validateViewStyle({ $ref: 'style.json' })).ok).toBe(false);
  });

  it('names the filter path of an added ub-clusters layer with a legacy filter', async () => {
    const style = {
      layers: [
        {
          id: 'legacy',
          type: 'circle',
          source: SOURCES.clusters,
          filter: ['==', 'art', 'x'],
          paint: { 'circle-radius': 4 },
        },
      ],
    };
    const result = await validateViewStyle(style);
    expect(result).toMatchObject({
      ok: false,
      errors: [
        {
          path: 'layers[0].filter',
          layerId: 'legacy',
          message:
            'filters on layers over ub-clusters must use expression syntax, e.g. ["==", ["get", "art"], "x"]',
        },
      ],
    });
  });

  it('accepts an expression filter on an added ub-clusters layer', async () => {
    const style = {
      layers: [
        {
          id: 'mine',
          type: 'circle',
          source: SOURCES.clusters,
          filter: ['==', ['get', 'art'], 'x'],
          paint: { 'circle-radius': 4 },
        },
      ],
    };
    expect(await validateViewStyle(style)).toEqual({ ok: true });
  });

  it('accepts a legacy filter on a replaced default layer', async () => {
    const style = {
      layers: [
        {
          id: LAYER_IDS.cluster,
          type: 'circle',
          source: SOURCES.clusters,
          filter: ['==', 'art', 'x'],
          paint: { 'circle-radius': 4 },
        },
      ],
    };
    expect(await validateViewStyle(style)).toEqual({ ok: true });
  });

  it('accepts a legacy filter on an added layer over ub-geometry', async () => {
    const style = {
      layers: [
        {
          id: 'zone',
          type: 'fill',
          source: SOURCES.geometry,
          filter: ['==', 'art', 'x'],
          paint: { 'fill-color': '#f00' },
        },
      ],
    };
    expect(await validateViewStyle(style)).toEqual({ ok: true });
  });
});

describe('one definition', () => {
  it('exports the ids the renderer draws with', () => {
    expect(SOURCES).toEqual({ clusters: 'ub-clusters', geometry: 'ub-geometry' });
    expect(LAYER_IDS.single).toBe('ub-single');
  });

  it('ui defines SOURCES and LAYER_IDS in view-style.ts only', () => {
    const offenders: string[] = [];
    const walk = (d: URL): void => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (isPlanted(e.name)) continue;
        if (e.isDirectory()) walk(new URL(`${e.name}/`, d));
        else if (/\.(ts|svelte)$/.test(e.name) && !e.name.includes('.spec.') && e.name !== 'view-style.ts') {
          const text = readFileSync(new URL(e.name, d), 'utf8');
          if (/(const|let)\s+(SOURCES|LAYER_IDS)\b/.test(text)) offenders.push(e.name);
        }
      }
    };
    walk(new URL('../', import.meta.url));
    expect(offenders).toEqual([]);
  });
});

describe('lazy loading', () => {
  it('view-style.ts has no static import of maplibre-gl or the style spec', () => {
    const src = readFileSync(new URL('./view-style.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/^import[^;]*from\s+'[^.][^']*'/m);
    expect(src).not.toMatch(/maplibre-gl/);
    expect(src).toMatch(/import\('\.\/maplibre\/style-spec'\)/);
  });

  it('loads the style spec only when validateViewStyle is called', async () => {
    vi.resetModules();
    const loaded = vi.fn();
    vi.doMock('@maplibre/maplibre-gl-style-spec', async (orig) => {
      loaded();
      return orig();
    });
    const mod = await import('./view-style');
    expect(loaded).not.toHaveBeenCalled();
    await mod.validateViewStyle({ layers: [] });
    expect(loaded).toHaveBeenCalledTimes(1);
    vi.doUnmock('@maplibre/maplibre-gl-style-spec');
  });

  it('is exported as the subpath @ueberblick/ui/view-style', () => {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(raw) as { exports: Record<string, string> };
    expect(pkg.exports['./view-style']).toBe('./src/map/view-style.ts');
  });
});
