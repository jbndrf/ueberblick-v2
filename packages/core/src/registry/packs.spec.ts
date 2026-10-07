import { describe, expect, it } from 'vitest';
import { PACK_TILE_BYTES, PACK_TILE_TYPES } from './packs';

describe('PACK_TILE_BYTES', () => {
  it('has exactly the keys of PACK_TILE_TYPES', () => {
    expect(Object.keys(PACK_TILE_BYTES).sort()).toEqual(PACK_TILE_TYPES.entries.map((e) => e.key).sort());
  });
});
