import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createStyleRendererRegistry, defaultStyleRenderers, type StyleRenderer } from './renderers';
import { maplibre2d } from './maplibre-2d';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';

describe('style validation comes from the ui', () => {
  it('no builder source or manifest names the Style Spec package', () => {
    const root = join(__dirname, '../../..');
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        isPlanted(e.name) ? [] : e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      );
    const named = [...files(join(root, 'src')), join(root, 'package.json')].filter(
      (f) => !f.endsWith('style.spec.ts') && readFileSync(f, 'utf8').includes('maplibre-gl-style-spec'),
    );
    expect(named).toEqual([]);
  });
});

const controlByKey = (key: string) => {
  const c = maplibre2d.controls.find((x) => x.key === key);
  if (c === undefined) throw new Error(`no control ${key}`);
  return c;
};

describe('maplibre-2d style editing', () => {
  it('the default style is a valid Style Spec fragment', async () => {
    expect(await maplibre2d.validate(maplibre2d.defaultStyle())).toEqual([]);
  });

  it('every control reads back what it wrote', () => {
    const style = maplibre2d.defaultStyle();
    const color = controlByKey('point_color');
    const size = controlByKey('point_size');
    expect(color.read(color.write(style, '#c0392b'))).toBe('#c0392b');
    expect(size.read(size.write(style, 12))).toBe(12);
  });

  it('property: any control edit keeps the fragment valid (validator test)', async () => {
    const hex = fc
      .array(fc.integer({ min: 0, max: 255 }), { minLength: 3, maxLength: 3 })
      .map((rgb) => `#${rgb.map((n) => n.toString(16).padStart(2, '0')).join('')}`);
    await fc.assert(
      fc.asyncProperty(
        hex,
        fc.integer({ min: 1, max: 40 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        async (color, n, opacity) => {
          let style = maplibre2d.defaultStyle();
          for (const c of maplibre2d.controls) {
            const v = c.kind === 'color' ? color : c.key === 'area_opacity' ? opacity : n;
            style = c.write(style, v);
          }
          expect(await maplibre2d.validate(style)).toEqual([]);
        },
      ),
    );
  });

  it('does not mutate the style it edits', () => {
    const style = maplibre2d.defaultStyle();
    const copy = JSON.stringify(style);
    controlByKey('line_color').write(style, '#000000');
    expect(JSON.stringify(style)).toBe(copy);
  });

  it('reports an invalid fragment with the layer it is in', async () => {
    const bad = {
      layers: [
        { id: 'ub-single', type: 'circle', source: 'ub-clusters', paint: { 'circle-radius': 'wide' } },
      ],
    };
    const issues = await maplibre2d.validate(bad);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.layerId).toBe('ub-single');
  });

  it('rejects a fragment without layers and an unknown layer source', async () => {
    expect(await maplibre2d.validate({})).not.toEqual([]);
    expect(await maplibre2d.validate({ layers: [{ id: 'x', type: 'circle', source: 'nope' }] })).not.toEqual(
      [],
    );
  });

  it('reads an expression value as not editable (undefined), never a wrong number', () => {
    const style = maplibre2d.defaultStyle() as { layers: { paint: Record<string, unknown> }[] };
    const withExpr = {
      layers: style.layers.map((l) => ({ ...l, paint: { ...l.paint, 'circle-color': ['get', 'c'] } })),
    };
    expect(controlByKey('point_color').read(withExpr)).toBeUndefined();
  });
});

describe('style renderer registry (H1)', () => {
  const fake3d: StyleRenderer = {
    key: 'fake-3d',
    label: { en: 'Fake 3D', de: 'Fake 3D' },
    defaultStyle: () => ({ extrusion: 10 }),
    controls: [
      {
        key: 'height',
        kind: 'number',
        label: { en: 'Height', de: 'Höhe' },
        min: 0,
        max: 500,
        step: 1,
        read: (s) => (typeof s.extrusion === 'number' ? s.extrusion : undefined),
        write: (s, v) => ({ ...s, extrusion: v }),
      },
    ],
    validate: async (s) =>
      typeof s.extrusion === 'number' ? [] : [{ message: 'extrusion must be a number' }],
  };

  it('ships maplibre-2d', () => {
    expect(defaultStyleRenderers().get('maplibre-2d')).toBe(maplibre2d);
  });

  it('registers a further renderer without any lens change', () => {
    const registry = defaultStyleRenderers();
    registry.register(fake3d);
    expect(registry.get('fake-3d')?.defaultStyle()).toEqual({ extrusion: 10 });
    expect(registry.all().map((r) => r.key)).toEqual(['maplibre-2d', 'fake-3d']);
  });

  it('refuses a duplicate key', () => {
    const registry = createStyleRendererRegistry([fake3d]);
    expect(() => registry.register(fake3d)).toThrow(/already/);
  });
});
