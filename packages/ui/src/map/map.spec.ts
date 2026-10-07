import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { isPlanted } from '../../../../scripts/testing/plant.mjs';
import type { FeatureId, Key } from '@ueberblick/core/model';
import type { FoldedFeature } from '@ueberblick/core/fold';
import type { View } from '@ueberblick/core/model';
import { toMapFeature } from './anchor';
import { UnknownRendererError, type MapHandle, type ViewRenderer } from './contract';
import { createRendererMap, getRenderer } from './renderers';
import { pointFeature, testSource } from './test-helpers';

const geom = 'geometry' as Key;

describe('anchors', () => {
  it('uses derived.pointOnSurface, never a vertex mean', () => {
    // A C-shaped polygon: the vertex mean lies in the notch, outside the area.
    const polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 2],
          [2, 2],
          [2, 8],
          [10, 8],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    };
    const folded = {
      id: 'f1' as FeatureId,
      type: 'baum' as Key,
      properties: { geometry: polygon },
      lifecycle: 'active',
      updatedSeq: 1,
      derived: {
        geometry: {
          bbox: [0, 0, 10, 10],
          pointOnSurface: { type: 'Point', coordinates: [1, 5] },
          centroid: { type: 'Point', coordinates: [4, 5] },
          areaM2: 1,
          lengthM: 1,
        },
      },
    } as unknown as FoldedFeature;
    const mf = toMapFeature(folded, geom);
    expect(mf?.anchor).toEqual([1, 5]);
    expect(mf?.geometry).toEqual(polygon); // polygons keep their geometry for drawing
  });

  it('skips features without a value for the geometry property', () => {
    const folded = {
      id: 'f' as FeatureId,
      type: 'baum' as Key,
      properties: {},
      lifecycle: 'active',
      updatedSeq: 1,
      derived: {},
    };
    expect(toMapFeature(folded as FoldedFeature, geom)).toBeUndefined();
  });
});

describe('renderer registry seam (H1)', () => {
  it('has maplibre-2d built in', () => {
    expect(getRenderer(createRendererMap(), 'maplibre-2d')).toBeDefined();
  });

  it('an unknown key is a typed error', () => {
    expect(() => getRenderer(createRendererMap(), 'cesium-3d')).toThrow(UnknownRendererError);
  });

  it('registers a stub second renderer without touching maplibre/', () => {
    const taps: FeatureId[] = [];
    const stub: ViewRenderer = {
      mount(_el, _view, source): MapHandle {
        source.subscribe([-180, -90, 180, 90], () => undefined);
        return {
          ready: Promise.resolve(),
          onFeatureTap: (l) => {
            taps.push('x' as FeatureId);
            l('x' as FeatureId);
            return () => undefined;
          },
          // a renderer with no MapLibre in it implements the tool ports from the neutral types alone (H1)
          onMapTap: () => () => undefined,
          centerOn: () => undefined,
          zoomBy: () => undefined,
          showOverlay: () => undefined,
          clearOverlay: () => undefined,
          addMarker: () => undefined,
          moveMarker: () => undefined,
          markerPosition: () => undefined,
          removeMarker: () => undefined,
          onMarkerDrag: () => () => undefined,
          setDoubleClickZoom: () => undefined,
          project: () => undefined,
          unproject: () => undefined,
          onMove: () => () => undefined,
          extent: () => [0, 0, 1, 1],
          onExtentChange: () => () => undefined,
          setView: () => undefined,
          destroy: () => undefined,
        };
      },
    };
    const renderers = createRendererMap(new Map([['stub-3d', stub]]));
    const handle = getRenderer(renderers, 'stub-3d').mount(
      {} as HTMLElement,
      {} as View,
      testSource([pointFeature('a', 1, 1)]),
    );
    handle.onFeatureTap(() => undefined);
    expect(taps).toHaveLength(1);
  });
});

describe('lazy MapLibre', () => {
  const dir = new URL('./', import.meta.url);
  const files = (d: URL): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      isPlanted(e.name)
        ? []
        : e.isDirectory()
          ? files(new URL(`${e.name}/`, d))
          : [new URL(e.name, d).pathname],
    );
  // e2e harness pages are test fixtures that are never shipped: they may name the library to serve its worker
  const sources = files(dir).filter(
    (f) => /\.(ts|svelte)$/.test(f) && !f.endsWith('.spec.ts') && !f.includes('/e2e/'),
  );

  it('imports maplibre-gl only dynamically, and only inside maplibre/', () => {
    for (const file of sources) {
      const src = readFileSync(file, 'utf8');
      expect(/^\s*import[^;]*from\s+['"]maplibre-gl['"]/m.test(src), file).toBe(false);
      if (!file.includes('/map/maplibre/')) expect(src.includes('maplibre-gl'), file).toBe(false);
    }
  });

  it('the ui entry does not import the maplibre folder', () => {
    const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(entry).not.toMatch(/maplibre/);
    const map = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    // only the pack protocol (WP-650) is exported from there: it imports neither MapLibre nor pmtiles at load
    expect(map).not.toMatch(/from '.\/maplibre\/(?!packs')/);
  });
});
