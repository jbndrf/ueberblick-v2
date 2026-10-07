import { describe, expect, it } from 'vitest';
import { packsForRoles, type MapPacksLike } from './map-layers';

const layer = (roles?: string[]) => ({ kind: 'base', ...(roles === undefined ? {} : { roles }) });
const map: MapPacksLike = {
  layers: { osm: layer(), flur: layer(['verwaltung']), intern: layer(['verwaltung']) },
  packs: {
    all: { layers: ['osm', 'flur'] },
    kontrolle: { layers: ['osm'], roles: ['kontrolle'] },
    nur_intern: { layers: ['intern'] },
    ghost: { layers: ['missing'] },
  },
};

describe('packsForRoles', () => {
  it('lists a pack with only the layers the roles see', () => {
    expect(packsForRoles(map, ['kontrolle'])).toEqual([
      { key: 'all', layers: ['osm'] },
      { key: 'kontrolle', layers: ['osm'] },
    ]);
  });
  it('drops a pack whose roles miss, and one with no visible layer', () => {
    expect(packsForRoles(map, ['verwaltung'])).toEqual([
      { key: 'all', layers: ['osm', 'flur'] },
      { key: 'nur_intern', layers: ['intern'] },
    ]);
    expect(packsForRoles(map, []).map((p) => p.key)).toEqual(['all']);
  });
  it('is empty without packs', () => {
    expect(packsForRoles({ layers: map.layers }, ['verwaltung'])).toEqual([]);
  });
});
