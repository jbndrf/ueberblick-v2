// WP-621: a bad `advanced` style of a map layer is a compile problem that names the layer key.
import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '../file';
import { compile, NO_ASSETS, type MapStyleChecker } from './index';
import { template1 } from '../../template/fixtures';

const withMap = (): TemplateFile =>
  ({
    ...template1,
    map: {
      layers: {
        luftbild: {
          label: 'Luftbild',
          kind: 'base',
          source: { type: 'preset', preset: 'osm' },
          advanced: { paint: { 'raster-opacity': 7 } },
        },
        gut: { label: 'Gut', kind: 'overlay', source: { type: 'geojson', url: '/a.geojson' } },
      },
    },
  }) as TemplateFile;

const checker: MapStyleChecker = (map) =>
  Object.entries(map.layers).flatMap(([layer, l]) =>
    l.advanced === undefined ? [] : [{ layer, message: 'raster-opacity: number expected between 0 and 1' }],
  );

describe('map layer styles at compile time', () => {
  it('reports the layer key and the Style Spec message', () => {
    const r = compile(withMap(), { assets: NO_ASSETS, mapStyles: checker });
    expect(r.ok).toBe(false);
    const p = !r.ok ? r.problems.filter((x) => x.code === 'style_invalid') : [];
    expect(p).toHaveLength(1);
    expect(p[0]?.path).toBe('map.layers.luftbild.advanced');
    expect(String(p[0]?.message)).toContain("layer 'luftbild'");
    expect(String(p[0]?.message)).toContain('raster-opacity');
  });

  it('compiles when the checker finds nothing, and without a checker', () => {
    expect(compile(withMap(), { assets: NO_ASSETS, mapStyles: () => [] }).ok).toBe(true);
    expect(compile(withMap(), { assets: NO_ASSETS }).ok).toBe(true);
  });

  it('is not asked when the file has no map', () => {
    let asked = false;
    compile(template1, {
      assets: NO_ASSETS,
      mapStyles: () => ((asked = true), []),
    });
    expect(asked).toBe(false);
  });
});
