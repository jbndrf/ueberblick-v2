import { describe, expect, it } from 'vitest';
import { createGeo } from './index';
import {
  ALL_VALID,
  BOWTIE,
  CW_EXTERIOR,
  EMPTY_LINE,
  HOLE_OUTSIDE,
  NESTED_SHELLS,
  NON_FINITE,
  OUT_OF_RANGE,
  SQUARE,
  SQUARE_Z,
  TOO_FEW,
  UNCLOSED,
} from './fixtures';
import type { Geometry } from './contract';
import { at } from './coords';

const geo = createGeo();
const issues = (g: Geometry) => geo.validate(g).issues.map((i) => i.issue);

describe('validate', () => {
  it('accepts every valid fixture', () => {
    for (const [name, g] of ALL_VALID) expect(geo.validate(g), name).toEqual({ valid: true, issues: [] });
  });

  it.each([
    ['empty', EMPTY_LINE],
    ['non_finite', NON_FINITE],
    ['out_of_range', OUT_OF_RANGE],
    ['too_few_points', TOO_FEW],
    ['ring_not_closed', UNCLOSED],
    ['self_intersection', BOWTIE],
    ['hole_outside_shell', HOLE_OUTSIDE],
    ['nested_shells', NESTED_SHELLS],
  ] as const)('reports %s', (issue, g) => {
    const r = geo.validate(g);
    expect(r.valid).toBe(false);
    expect(issues(g)).toContain(issue);
  });

  it('reports wrong winding but does not count it as invalid (normalise fixes it silently)', () => {
    const r = geo.validate(CW_EXTERIOR);
    expect(r.issues.map((i) => i.issue)).toEqual(['wrong_winding']);
    expect(r.valid).toBe(true);
  });

  it('points at the offending ring', () => {
    expect(geo.validate(HOLE_OUTSIDE).issues[0]?.path).toMatch(/^\/coordinates\/1/);
    expect(geo.validate(UNCLOSED).issues[0]?.path).toBe('/coordinates/0');
  });
});

describe('normalise winding and closing', () => {
  it('makes exterior counter-clockwise and closes rings', () => {
    expect(geo.normalise(CW_EXTERIOR)).toEqual(SQUARE);
    const closed = geo.normalise(UNCLOSED);
    if (closed.type !== 'Polygon') throw new Error('type');
    expect(closed.coordinates[0]).toHaveLength(5);
    expect(at(closed.coordinates, 0)[4]).toEqual(at(closed.coordinates, 0)[0]);
  });

  it('orients holes clockwise', () => {
    const holeCcw: Geometry = {
      type: 'Polygon',
      coordinates: [
        at(SQUARE.coordinates, 0),
        [
          [13.403, 52.503],
          [13.407, 52.503],
          [13.407, 52.507],
          [13.403, 52.507],
          [13.403, 52.503],
        ],
      ],
    };
    const out = geo.normalise(holeCcw);
    expect(geo.validate(out).issues).toEqual([]);
  });
});

describe('repair', () => {
  it('fixes unclosed rings and winding', () => {
    const r = geo.repair(UNCLOSED);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fixed).toContain('ring_not_closed');
      expect(geo.validate(r.geometry).valid).toBe(true);
    }
    const w = geo.repair(CW_EXTERIOR);
    expect(w.ok && w.fixed).toEqual(['wrong_winding']);
  });

  it('makes a bowtie valid, keeping both lobes', () => {
    const r = geo.repair(BOWTIE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fixed).toContain('self_intersection');
    expect(geo.validate(r.geometry).valid).toBe(true);
    // two triangles of 0.5 * 0.01 deg * 0.005 deg (about 0.3 km2 each at the equator)
    expect(geo.derive(r.geometry).areaM2).toBeGreaterThan(5000);
  });

  it('keeps the Z of every original vertex when repairing a bow-tie', () => {
    const zBowtie: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0, 1],
          [0.01, 0.01, 2],
          [0.01, 0, 3],
          [0, 0.01, 4],
          [0, 0, 1],
        ],
      ],
    };
    const r = geo.repair(zBowtie);
    expect(r.ok).toBe(true);
    if (!r.ok || r.geometry.type !== 'MultiPolygon') throw new Error('expected a repaired multipolygon');
    const zAt = new Map<string, number | undefined>();
    for (const poly of r.geometry.coordinates)
      for (const ring of poly) for (const p of ring) zAt.set(`${p[0]},${p[1]}`, p[2]);
    expect(zAt.get('0,0')).toBe(1);
    expect(zAt.get('0.01,0.01')).toBe(2);
    expect(zAt.get('0.01,0')).toBe(3);
    expect(zAt.get('0,0.01')).toBe(4);
  });

  it('removes a hole outside the shell and merges overlapping members', () => {
    const a = geo.repair(HOLE_OUTSIDE);
    expect(a.ok && geo.validate(a.geometry).valid).toBe(true);
    const b = geo.repair(NESTED_SHELLS);
    expect(b.ok && geo.validate(b.geometry).valid).toBe(true);
  });

  it('refuses what cannot be repaired', () => {
    for (const g of [EMPTY_LINE, NON_FINITE, OUT_OF_RANGE, TOO_FEW]) {
      const r = geo.repair(g);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
    }
  });

  it('returns valid input unchanged apart from normalisation, Z included', () => {
    const r = geo.repair(SQUARE_Z);
    expect(r).toEqual({ ok: true, geometry: SQUARE_Z, fixed: [] });
  });
});
