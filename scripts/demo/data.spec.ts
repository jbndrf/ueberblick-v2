// WP-994: the sample data lies around the project's own map start, and "Nord" is north of "Süd".
import { describe, expect, it } from 'vitest';
import {
  areas,
  buildings,
  events,
  melderCsv,
  reports,
  seeded,
  startCentre,
  TOWN,
  townPoints,
  trees,
} from './data';

const MUEHLHAUSEN = { lon: 10.4515, lat: 51.1657 };
const km = (a: { lon: number; lat: number }, lon: number, lat: number): number =>
  Math.hypot((lon - a.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180), (lat - a.lat) * 110.54);

type Pos = [number, number];
const coordsOf = (json: string): Pos[] =>
  (JSON.parse(json).features as { geometry: { type: string; coordinates: unknown } }[]).flatMap((f) =>
    f.geometry.type === 'Point'
      ? [f.geometry.coordinates as Pos]
      : (f.geometry.coordinates as Pos[][]).flat(),
  );

describe('startCentre', () => {
  it('reads the compiled config`s map.start, else the default town', () => {
    expect(startCentre({ map: { start: { center: [10.4515, 51.1657] } } })).toEqual(MUEHLHAUSEN);
    expect(startCentre({ map: {} })).toEqual(TOWN);
    expect(startCentre({})).toEqual(TOWN);
  });
});

describe('sample data around a centre', () => {
  const today = new Date('2026-10-03T00:00:00Z');
  it('every generated feature lies within 5 km of the centre', () => {
    const all = [
      trees(1001, 150, MUEHLHAUSEN),
      reports(2002, 70, MUEHLHAUSEN),
      buildings(3003, 12, MUEHLHAUSEN),
      events(3004, 24, today, MUEHLHAUSEN),
      areas(MUEHLHAUSEN),
    ];
    for (const json of all)
      for (const [lon, lat] of coordsOf(json)) expect(km(MUEHLHAUSEN, lon, lat)).toBeLessThan(5);
  });

  it('the CSV reports carry positions near the centre', () => {
    const rows = melderCsv(2003, 5, MUEHLHAUSEN).split('\n').slice(1);
    for (const r of rows) {
      const [, , lon, lat] = r.split(',');
      expect(km(MUEHLHAUSEN, Number(lon), Number(lat))).toBeLessThan(5);
    }
  });

  it('points are deterministic', () => {
    expect(townPoints(seeded(1), 10, MUEHLHAUSEN)).toEqual(townPoints(seeded(1), 10, MUEHLHAUSEN));
  });

  it('every tree lies inside one area', () => {
    const boxes = (JSON.parse(areas(MUEHLHAUSEN)).features as { geometry: { coordinates: Pos[][] } }[]).map(
      (f) => {
        const ring = f.geometry.coordinates.flat();
        const lons = ring.map((c) => c[0]);
        const lats = ring.map((c) => c[1]);
        return { w: Math.min(...lons), e: Math.max(...lons), s: Math.min(...lats), n: Math.max(...lats) };
      },
    );
    for (const [lon, lat] of coordsOf(trees(1001, 150, MUEHLHAUSEN)))
      expect(boxes.some((b) => lon >= b.w && lon <= b.e && lat >= b.s && lat <= b.n)).toBe(true);
  });
});

describe('areas', () => {
  it('"Nord" areas have a larger latitude than "Süd" areas', () => {
    const features = JSON.parse(areas(MUEHLHAUSEN)).features as {
      properties: { name: string };
      geometry: { coordinates: number[][][] };
    }[];
    const minLat = (f: (typeof features)[number]): number =>
      Math.min(...(f.geometry.coordinates[0] ?? []).map((c) => c[1] ?? 0));
    const north = features.filter((f) => f.properties.name.includes('Nord'));
    const south = features.filter((f) => f.properties.name.includes('Süd'));
    expect(north).toHaveLength(3);
    expect(south).toHaveLength(3);
    for (const n of north) for (const s of south) expect(minLat(n)).toBeGreaterThan(minLat(s));
  });
});
