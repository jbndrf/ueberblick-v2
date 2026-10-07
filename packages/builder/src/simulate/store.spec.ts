// WP-202/WP-130: the simulator's store (core's MemoryStore) must agree with core's relation semantics (expr/sql/values.ts: edges join
// live features only) and implement the required `Facts.near` (WP-041.1).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  compile,
  NO_ASSETS,
  createGeo,
  type Bbox,
  type FeatureId,
  type Key,
  type RunId,
} from '@ueberblick/core';
import { MemoryStore } from '@ueberblick/core/memory';
import { SIM_CONFIG_VERSION } from '@ueberblick/core/testing';
import { openProject } from '../doc';
import { musterstadt } from '../testing/golden';
import { fid } from './scenario-runner';

const RUN = 'r' as RunId;
const clock = { now: () => '2026-05-01T08:00:00.000Z' };
type Sandbox = MemoryStore;
const sandbox = (c: ReturnType<typeof config>): Sandbox =>
  new MemoryStore(c, clock, createGeo(), SIM_CONFIG_VERSION);
/** With `second` a second geometry property `standort2` on `baum`. */
const config = (second = false) => {
  const file = structuredClone(openProject(musterstadt.templateSrc, musterstadt.overlaySrc).effective());
  if (second) {
    (file.types?.['baum']?.properties as Record<string, unknown>)['standort2'] = {
      type: 'geometry',
      geometry_type: 'point',
    };
  }
  const r = compile(file, { assets: NO_ASSETS });
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.config;
};
const square = (x: number, y: number, s: number) => ({
  type: 'Polygon',
  coordinates: [
    [
      [x, y],
      [x + s, y],
      [x + s, y + s],
      [x, y + s],
      [x, y],
    ],
  ],
});
const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });

function create(sb: Sandbox, id: FeatureId, type: string, properties: Record<string, unknown>) {
  const obs = [
    { featureId: id, property: '$type', result: type },
    ...Object.entries(properties).map(([property, result]) => ({ featureId: id, property, result })),
  ];
  sb.append(RUN, obs as never);
}
const remove = (sb: Sandbox, id: FeatureId) =>
  sb.append(RUN, [{ featureId: id, property: '$lifecycle', result: 'deleted' }]);

describe('simulator store relation semantics', () => {
  const setup = () => {
    const sb = sandbox(config());
    create(sb, fid(1), 'flaeche', { name: 'Park', geometrie: square(7.1, 50.73, 0.01) });
    create(sb, fid(2), 'baum', { geometrie: point(7.102, 50.732), stage: 'erfasst' });
    return sb;
  };

  it('a derived edge to a live feature is visible from both ends', () => {
    const sb = setup();
    expect(sb.edgesFrom(fid(2), 'flaeche' as Key).map((e) => e.to)).toEqual([fid(1)]);
    expect(sb.edgesTo(fid(1), 'flaeche' as Key).map((e) => e.from)).toEqual([fid(2)]);
  });

  it('a deleted related feature is excluded from both directions', () => {
    const sb = setup();
    remove(sb, fid(1));
    expect(sb.edgesFrom(fid(2), 'flaeche' as Key)).toEqual([]);
    expect(sb.edgesTo(fid(1))).toEqual([]);
    const sb2 = setup();
    remove(sb2, fid(2));
    expect(sb2.edgesTo(fid(1), 'flaeche' as Key)).toEqual([]);
  });

  // KNOWN GAP (WP-130, core/memory owner): MemoryStore.edgesFrom/edgesTo do not skip edges to a missing
  // feature, the server does (expr/sql/values.ts). `it.fails` turns red when core fixes it: then make it `it`.
  it('an edge to a missing target is excluded', () => {
    const sb = setup();
    create(sb, fid(3), 'baum', { geometrie: point(7.5, 50.9), art: fid(999), stage: 'erfasst' });
    expect(sb.edgesFrom(fid(3), 'art' as Key)).toEqual([]);
    create(sb, fid(999), 'baumart', { name_de: 'Linde' });
    expect(sb.edgesFrom(fid(3), 'art' as Key).map((e) => e.to)).toEqual([fid(999)]);
  });
});

describe('simulator store near', () => {
  it('returns live features of the type whose bbox intersects, edge contact included', () => {
    const sb = sandbox(config());
    create(sb, fid(1), 'flaeche', { name: 'Park', geometrie: square(7.1, 50.73, 0.01) });
    create(sb, fid(2), 'baum', { geometrie: point(7.102, 50.732), stage: 'erfasst' });
    const ids = (type: string, bbox: Bbox) => [...sb.near(type as Key, bbox)].map((f) => f.id);
    expect(ids('baum', [7.1, 50.73, 7.11, 50.74])).toEqual([fid(2)]);
    expect(ids('flaeche', [7.1 + 0.01, 50.73 + 0.01, 7.2, 50.8])).toEqual([fid(1)]); // touches the corner
    expect(ids('baum', [8, 51, 8.1, 51.1])).toEqual([]);
    expect(ids('flaeche', [7.102, 50.732, 7.103, 50.733])).toEqual([fid(1)]);
    expect(ids('baumart', [0, 0, 90, 90])).toEqual([]);
    remove(sb, fid(2));
    expect(ids('baum', [7.1, 50.73, 7.11, 50.74])).toEqual([]);
  });

  it('tests one union bbox per feature over all geometry properties', () => {
    const sb = sandbox(config(true));
    create(sb, fid(1), 'baum', {
      geometrie: point(7.1, 50.73),
      standort2: point(7.2, 50.8),
      stage: 'erfasst',
    });
    const hit = (bbox: Bbox) => [...sb.near('baum' as Key, bbox)].map((f) => f.id);
    expect(hit([7.15, 50.76, 7.16, 50.77])).toEqual([fid(1)]); // between the two points, on neither
    expect(hit([7.1, 50.73, 7.1, 50.73])).toEqual([fid(1)]);
    expect(hit([7.2, 50.8, 7.3, 50.9])).toEqual([fid(1)]);
    expect(hit([7.3, 50.9, 7.4, 51])).toEqual([]);
  });

  it('property: agrees with a brute-force union-bbox filter over random point pairs and bboxes', () => {
    const c = fc.integer({ min: 0, max: 20 });
    fc.assert(
      fc.property(
        fc.array(fc.tuple(c, c, c, c), { minLength: 1, maxLength: 10 }),
        fc.tuple(c, c, fc.nat(8), fc.nat(8)),
        (pts, [x, y, w, h]) => {
          const sb = sandbox(config(true));
          pts.forEach(([px, py, qx, qy], i) =>
            create(sb, fid(i + 1), 'baum', {
              geometrie: point(7 + px / 100, 50 + py / 100),
              standort2: point(7 + qx / 100, 50 + qy / 100),
              stage: 'erfasst',
            }),
          );
          const box: Bbox = [7 + x / 100, 50 + y / 100, 7 + (x + w) / 100, 50 + (y + h) / 100];
          const want = pts
            .map(([px, py, qx, qy], i) => ({
              id: fid(i + 1),
              x0: 7 + Math.min(px, qx) / 100,
              y0: 50 + Math.min(py, qy) / 100,
              x1: 7 + Math.max(px, qx) / 100,
              y1: 50 + Math.max(py, qy) / 100,
            }))
            .filter((p) => p.x0 <= box[2] && box[0] <= p.x1 && p.y0 <= box[3] && box[1] <= p.y1)
            .map((p) => p.id)
            .sort();
          expect([...sb.near('baum' as Key, box)].map((f) => f.id).sort()).toEqual(want);
        },
      ),
      { numRuns: 30 },
    );
  });
});
