/**
 * WP-746 / B-024: the type's configured look (`marker`, the one the filter sheet shows) is the single source of a
 * feature's marker and area colour. Since WP-747 every type resolves to a look (the default look when none is
 * configured), so a demo template's view style must not restyle the features of any type (circle / fill / line / icon layers); labels and other context layers stay allowed.
 * v3 had no such thing: markers came from the workflow icons only (reference/src/lib/components/map/map-icons.ts).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { goldenConfig } from '@ueberblick/core/testing';
import { isPlanted } from '../../../../../scripts/testing/plant.mjs';

const GOLDEN = fileURLToPath(new URL('../../../../../fixtures/golden/', import.meta.url));

interface Layer {
  readonly source?: { readonly type?: string };
  readonly style?: { readonly $ref?: string };
}
interface Doc {
  readonly types?: Record<string, { readonly marker?: unknown }>;
  readonly views?: Record<string, { readonly layers?: Record<string, Layer> }>;
}
interface StyleLayer {
  readonly id: string;
  readonly type: string;
  readonly layout?: Record<string, unknown>;
}

const FEATURE_PAINT = new Set(['circle', 'fill', 'line', 'fill-extrusion', 'heatmap']);
const restyles = (l: StyleLayer): boolean =>
  FEATURE_PAINT.has(l.type) || (l.type === 'symbol' && l.layout?.['icon-image'] !== undefined);

const templates = readdirSync(join(GOLDEN, 'templates'), { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.yaml') && !isPlanted(f))
  .sort();

describe('golden view styles do not restyle looked types (B-024)', () => {
  it('walks the corpus templates', () => {
    expect(templates.length).toBeGreaterThanOrEqual(5);
  });

  it.each(templates)('%s', (file) => {
    const doc = parse(readFileSync(join(GOLDEN, 'templates', file), 'utf8')) as Doc;
    const offenders: string[] = [];
    for (const [view, v] of Object.entries(doc.views ?? {}))
      for (const [name, layer] of Object.entries(v.layers ?? {})) {
        const type = layer.source?.type;
        const ref = layer.style?.$ref;
        if (type === undefined || ref === undefined || doc.types?.[type] === undefined) continue;
        const style = JSON.parse(readFileSync(join(GOLDEN, ref), 'utf8')) as { layers?: StyleLayer[] };
        for (const l of style.layers ?? [])
          if (restyles(l))
            offenders.push(`views.${view}.layers.${name} (${type}): ${ref} layer ${l.id} (${l.type})`);
      }
    expect(offenders).toEqual([]);
  });
});

/**
 * Rendered result: a looked type's view layer has no style, so the renderer draws the default layers by value
 * (`resolveLayers` with the look plan, packages/ui looks.spec.ts), the same look the filter sheet shows.
 */
describe('compiled demo configs: looked types are drawn by their look alone', () => {
  it.each(templates.map((f) => `templates/${f}`))('%s', (path) => {
    const cfg = goldenConfig(path) as unknown as Doc;
    const styled = Object.entries(cfg.views ?? {}).flatMap(([view, v]) =>
      Object.entries(v.layers ?? {})
        .filter(([, l]) => l.source?.type !== undefined && cfg.types?.[l.source.type] !== undefined)
        .filter(([, l]) => (l as { style?: unknown }).style !== undefined)
        .map(([name]) => `${view}.${name}`),
    );
    expect(styled).toEqual([]);
  });
});
