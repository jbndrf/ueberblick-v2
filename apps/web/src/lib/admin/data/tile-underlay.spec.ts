import { describe, expect, it } from 'vitest';
import { previewShape as shapeOrNull, type PreviewShape } from './geometry-svg';
import { previewBasemap, underlayTiles } from './tile-underlay';

function previewShape(geometry: unknown, b: typeof box): PreviewShape {
  const s = shapeOrNull(geometry, b);
  if (s === null) throw new Error('no shape');
  return s;
}
const first = <T>(xs: readonly T[]): T => {
  const x = xs[0];
  if (x === undefined) throw new Error('empty');
  return x;
};
const box = { width: 240, height: 160, pad: 12 };
const basemap = { tiles: 'https://t.example/{z}/{x}/{y}.png', tileSize: 256, maxzoom: 19 };

describe('underlayTiles', () => {
  it('covers the box with tiles of the project basemap, under the shape', () => {
    const shape = previewShape({ type: 'Point', coordinates: [7.1, 50.2] }, box);
    const tiles = underlayTiles(basemap, shape.frame, box);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.src.startsWith('https://t.example/18/'))).toBe(true);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + t.size))).toBeGreaterThanOrEqual(box.width);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.top + t.size))).toBeGreaterThanOrEqual(box.height);
  });

  it('chooses a coarser zoom for a larger shape and never goes beyond the basemap maxzoom', () => {
    const big = previewShape(
      {
        type: 'LineString',
        coordinates: [
          [6, 50],
          [8, 51],
        ],
      },
      box,
    );
    const zOf = (src: string): number => Number(src.split('/')[3]);
    expect(zOf(first(underlayTiles(basemap, big.frame, box)).src)).toBeLessThan(10);
    const pt = previewShape({ type: 'Point', coordinates: [7, 50] }, box);
    expect(zOf(first(underlayTiles({ ...basemap, maxzoom: 15 }, pt.frame, box)).src)).toBe(15);
  });

  it('places the anchor of a point in the tile that holds it', () => {
    const shape = previewShape({ type: 'Point', coordinates: [7.1, 50.2] }, box);
    const [cx, cy] = first(shape.points);
    const hit = underlayTiles(basemap, shape.frame, box).filter(
      (t) => cx >= t.left && cx < t.left + t.size && cy >= t.top && cy < t.top + t.size,
    );
    expect(hit).toHaveLength(1);
  });
});

describe('previewBasemap', () => {
  const layer = (source: Record<string, unknown>) =>
    ({
      layers: { b: { kind: 'base', label: 'B', source } },
    }) as never;
  it('reads an xyz base and a preset base', () => {
    expect(previewBasemap(layer({ type: 'xyz', url: 'https://x.test/{z}/{x}/{y}.png' }), 'demo')?.tiles).toBe(
      '/api/p/demo/tiles/b/{z}/{x}/{y}',
    );
    expect(previewBasemap(layer({ type: 'preset', preset: 'osm' }), 'demo')?.tiles).toBe(
      '/api/p/demo/tiles/b/{z}/{x}/{y}',
    );
  });
  it('keeps a self-hosted base direct and draws a remote raster pmtiles archive from the proxy', () => {
    expect(previewBasemap(layer({ type: 'xyz', url: '/tiles/{z}/{x}/{y}.png' }), 'demo')?.tiles).toBe(
      '/tiles/{z}/{x}/{y}.png',
    );
    expect(previewBasemap(layer({ type: 'pmtiles', url: 'https://p.test/a.pmtiles' }), 'demo')?.tiles).toBe(
      '/api/p/demo/tiles/b/{z}/{x}/{y}',
    );
  });
  it('gives null without a map or for a base it cannot draw as plain tiles', () => {
    expect(previewBasemap(undefined, 'demo')).toBeNull();
    expect(previewBasemap(layer({ type: 'wms', url: 'https://w.test', layers: 'a' }), 'demo')).toBeNull();
  });
});
