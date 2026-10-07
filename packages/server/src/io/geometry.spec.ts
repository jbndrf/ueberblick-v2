import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createGeo, type Geometry } from '@ueberblick/core';
import { prepareGeometry } from './geometry';

const geo = createGeo();
const WGS = 'EPSG:4326' as const;
/** A bow-tie: self-intersecting, so invalid, but `makeValid` can fix it. */
const BOWTIE: Geometry = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [2, 2],
      [2, 0],
      [0, 2],
      [0, 0],
    ],
  ],
};

describe('prepareGeometry', () => {
  it('repairs an invalid geometry by default (import and migration both)', () => {
    const r = prepareGeometry(geo, BOWTIE, { sourceCrs: WGS });
    expect('geometry' in r && geo.validate(r.geometry).valid).toBe(true);
  });

  it('refuses the same geometry when repair is off, naming the issue', () => {
    const r = prepareGeometry(geo, BOWTIE, { sourceCrs: WGS, repair: false });
    expect(r).toMatchObject({ message: expect.stringContaining('invalid geometry') });
  });

  it('reprojects, checks the kind and the bounds', () => {
    const p: Geometry = { type: 'Point', coordinates: [500000, 5538630.703] };
    const ok = prepareGeometry(geo, p, { sourceCrs: 'EPSG:25832', kind: 'point' });
    expect(ok).toMatchObject({ geometry: { type: 'Point' } });
    expect(prepareGeometry(geo, p, { sourceCrs: 'EPSG:25832', kind: 'polygon' })).toEqual({
      message: 'expected Polygon, found Point',
    });
    expect(prepareGeometry(geo, { type: 'Point', coordinates: [500, 5] }, { sourceCrs: WGS })).toEqual({
      message: 'outside the bounds of EPSG:4326',
    });
  });
});

describe('R1: one copy', () => {
  it('migration has no geometry preparation of its own', () => {
    const dir = join(__dirname, '../../../../apps/migrate/src/data');
    const src = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .join('\n');
    expect(src).not.toMatch(/storableGeometry/);
    expect(src).not.toMatch(/geo\.repair\(/);
    expect(src).toMatch(/prepareGeometry/);
  });
});
