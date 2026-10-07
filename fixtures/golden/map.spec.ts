// The golden project musterstadt-plain has an OSM base (from its template) and a WMS overlay (its own).
import { describe, expect, it } from 'vitest';
import { MapSchema } from '../../packages/core/src/schema';
import { defaultSelection, layersForRoles } from '../../packages/core/src/registry';
import { OverlayFileSchema } from '../../packages/core/src/schema/file';
import { merge } from '../../packages/core/src/template';
import { goldenYaml, newestTemplate } from '../../packages/core/src/testing';

describe('golden map backgrounds', () => {
  const overlay = OverlayFileSchema.parse(goldenYaml('projects/musterstadt-plain.yaml'));
  const m = merge(newestTemplate('baumkataster', '1'), overlay);
  const map = MapSchema.parse((m.file as unknown as { map: unknown }).map);

  it('merges cleanly and has an OSM base and a WMS overlay', () => {
    expect(m.issues).toEqual([]);
    expect(map.layers['osm']).toMatchObject({ kind: 'base', source: { type: 'preset', preset: 'osm' } });
    expect(map.layers['flurkarte']).toMatchObject({ kind: 'overlay', source: { type: 'wms' } });
    expect(defaultSelection(map)).toEqual({ base: 'osm', overlays: [] });
  });

  it('the WMS overlay is only for verwaltung', () => {
    expect(Object.keys(layersForRoles(map, ['kontrolle']).layers)).toEqual(['osm']);
    expect(Object.keys(layersForRoles(map, ['verwaltung']).layers)).toEqual(['osm', 'flurkarte']);
  });
});
