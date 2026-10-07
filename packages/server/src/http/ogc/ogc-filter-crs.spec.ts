import type { FeatureId } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { IDS } from '../../store/run/testkit';
import { coreCrs } from './core-seams';
import { ogcWorld } from './testkit';

const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ids = (fc: Record<string, any>): string[] => fc['features'].map((f: { id: string }) => f.id).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('CQL2 filter and CRS through the core seams', () => {
  const at = (q: string) => `/collections/baum/items?${q}`;
  const enc = encodeURIComponent;

  it('CQL2 text filter selects by a property', async () => {
    const w = await ogcWorld();
    expect(ids(await json(await w.get(at(`filter=${enc("vitalitaet='v2'")}`))))).toEqual([IDS.t_in]);
    expect(ids(await json(await w.get(at(`filter=${enc("vitalitaet IN ('v1','v4')")}`))))).toEqual(
      [IDS.t_hole, IDS.t_out].sort(),
    );
  });

  it('CQL2 JSON filter with filter-lang=cql2-json', async () => {
    const w = await ogcWorld();
    const filter = JSON.stringify({ op: '=', args: [{ property: 'vitalitaet' }, 'v4'] });
    const r = await w.get(at(`filter-lang=cql2-json&filter=${enc(filter)}`));
    expect(ids(await json(r))).toEqual([IDS.t_out]);
  });

  it('a filter never widens what the actor may see', async () => {
    const w = await ogcWorld({ scoped: true });
    const r = await w.get(at(`filter=${enc("vitalitaet IN ('v1','v2','v4')")}`), w.cookies.anna);
    expect(ids(await json(r))).toEqual([IDS.t_in]);
  });

  it('a spatial filter is bounded by the bbox of its geometry and combines with a property filter', async () => {
    const w = await ogcWorld();
    const poly = 'POLYGON((7.09 50.72, 7.11 50.72, 7.11 50.74, 7.09 50.74, 7.09 50.72))';
    const spatial = await json(await w.get(at(`filter=${enc(`S_INTERSECTS(geometrie, ${poly})`)}`)));
    expect(ids(spatial)).toEqual([IDS.t_hole, IDS.t_in].sort());
    const both = await json(
      await w.get(at(`filter=${enc(`vitalitaet='v1' AND S_INTERSECTS(geometrie, ${poly})`)}`)),
    );
    expect(ids(both)).toEqual([IDS.t_hole]);
    // no bbox anywhere: refused, never evaluated over all trees
    const open = await w.get(at(`filter=${enc(`S_DISJOINT(geometrie, ${poly})`)}`));
    expect(open.status).toBe(400);
    expect((await json(open))['error']['message']).toMatch(/bbox/);
  });

  // 9 degrees east is the central meridian of UTM zone 32: easting 500000 exactly. At 50 degrees north the
  // northing on GRS80 is 0.9996 * 5540847.04 = 5538630.7 (meridian arc length).
  const KNOWN = { lon: 9.0, lat: 50.0, e: 500_000, n: 5_538_630.7 };
  const UTM32 = 'http://www.opengis.net/def/crs/EPSG/0/25832';
  const KNOWN_ID = '00000000-0000-7000-8000-000000009999' as FeatureId;
  const known = async () => {
    const w = await ogcWorld();
    w.ctx.seed([
      {
        id: KNOWN_ID,
        type: 'baum',
        properties: { geometrie: { type: 'Point', coordinates: [KNOWN.lon, KNOWN.lat] }, stage: 'erfasst' },
      },
    ]);
    return w;
  };

  it('crs=EPSG:25832 returns the known projected coordinates and Content-Crs', async () => {
    const w = await known();
    const r = await w.get(`/collections/baum/items/${KNOWN_ID}`);
    expect((await json(r))['geometry']['coordinates']).toEqual([KNOWN.lon, KNOWN.lat]);
    const list = await w.get(at(`crs=${enc(UTM32)}&bbox=8.9,49.9,9.1,50.1`));
    expect(list.headers.get('content-crs')).toBe(`<${UTM32}>`);
    const f = (await json(list))['features'][0];
    expect(f.id).toBe(KNOWN_ID);
    const [e, n] = f.geometry.coordinates as [number, number];
    expect(Math.abs(e - KNOWN.e)).toBeLessThan(0.01);
    expect(Math.abs(n - KNOWN.n)).toBeLessThan(0.5);
  });

  it('bbox-crs reads a projected bbox around the known point', async () => {
    const w = await known();
    const box = (d: number) => `${KNOWN.e - d},${KNOWN.n - d},${KNOWN.e + d},${KNOWN.n + d}`;
    const hit = await json(await w.get(at(`bbox-crs=${enc(UTM32)}&bbox=${box(20)}`)));
    expect(ids(hit)).toEqual([KNOWN_ID]);
    // a box 100 m away misses it, so the CRS is really applied (as WGS84 degrees it would cover everything)
    const off = `${KNOWN.e + 100},${KNOWN.n + 100},${KNOWN.e + 140},${KNOWN.n + 140}`;
    expect(ids(await json(await w.get(at(`bbox-crs=${enc(UTM32)}&bbox=${off}`))))).toEqual([]);
    // EPSG:4326 takes lat/lon
    const ll = await json(
      await w.get(at(`bbox-crs=http://www.opengis.net/def/crs/EPSG/0/4326&bbox=49.999,8.999,50.001,9.001`)),
    );
    expect(ids(ll)).toEqual([KNOWN_ID]);
  });

  it('a write with Content-Crs 25832 lands at the matching WGS84 position', async () => {
    const w = await known();
    const moved = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [KNOWN.e + 100, KNOWN.n] },
      properties: {},
    };
    const res = await w.handlers.handle(
      new Request(`http://x/api/p/trees/ogc/collections/baum/items/${KNOWN_ID}`, {
        method: 'PATCH',
        headers: { cookie: w.cookies.admin, 'content-crs': `<${UTM32}>` },
        body: JSON.stringify(moved),
      }),
      { params: { project: 'trees', path: `collections/baum/items/${KNOWN_ID}` } },
    );
    expect(res.status).toBe(204);
    const [lon, lat] = (await json(await w.get(`/collections/baum/items/${KNOWN_ID}`)))['geometry'][
      'coordinates'
    ] as [number, number];
    // 100 m east at 50 N: 100 / (111320 * cos 50) / 0.9996 degrees
    expect(Math.abs(lon - (9 + 100 / (111_320 * Math.cos((50 * Math.PI) / 180) * 0.9996)))).toBeLessThan(
      2e-5,
    );
    expect(Math.abs(lat - 50)).toBeLessThan(2e-5);
  });

  it('fromWgs84 then toWgs84 gives the point back, for every served projected CRS', () => {
    for (const crs of coreCrs.supported.filter((c) => /EPSG\/0\/(25|31)/.test(c))) {
      const p = { type: 'Point', coordinates: [9.5, 50.5] } as const;
      const back = coreCrs.toWgs84(coreCrs.fromWgs84(p, crs), crs) as unknown as {
        coordinates: [number, number];
      };
      expect(Math.abs(back.coordinates[0] - 9.5)).toBeLessThan(1e-6);
      expect(Math.abs(back.coordinates[1] - 50.5)).toBeLessThan(1e-6);
    }
  });
});

describe('candidate cap of a residual filter', () => {
  it('is refused with 422 filter_too_broad, never truncated', async () => {
    const w = await ogcWorld({ deps: { residualScanCap: 2 } });
    const poly = 'POLYGON((7.0 50.0, 7.5 50.0, 7.5 51.0, 7.0 51.0, 7.0 50.0))';
    const r = await w.get(
      `/collections/baum/items?filter=${encodeURIComponent(`S_INTERSECTS(geometrie, ${poly})`)}`,
    );
    expect(r.status).toBe(422);
    expect((await json(r))['error']['code']).toBe('filter_too_broad');
    const ok = await ogcWorld();
    expect(
      (
        await ok.get(
          `/collections/baum/items?filter=${encodeURIComponent(`S_INTERSECTS(geometrie, ${poly})`)}`,
        )
      ).status,
    ).toBe(200);
  });
});

describe('paging under concurrent writes', () => {
  it('a create and an update before the cursor neither repeat nor skip what existed at page 1', async () => {
    const w = await ogcWorld();
    const first = await json(await w.get('/collections/baum/items?limit=2'));
    const link = first['links'].find((l: { rel: string }) => l.rel === 'next');
    expect(link).toBeDefined();
    // another writer: a new tree, and an update of a tree already delivered (its row keeps its place)
    w.ctx.seed([
      {
        id: '00000000-0000-7000-8000-000000008888' as FeatureId,
        type: 'baum',
        properties: { geometrie: { type: 'Point', coordinates: [7.2, 50.8] }, stage: 'erfasst' },
      },
    ]);
    const delivered = ids(first)[0] as string;
    const moved = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.1031, 50.7331] },
      properties: {},
    };
    expect((await w.send('PATCH', `/collections/baum/items/${delivered}`, moved)).status).toBe(204);
    const seen = [...first['features'].map((f: { id: string }) => f.id)];
    let path: string | undefined = link.href.replace('http://x/api/p/trees/ogc', '');
    for (let pages = 0; path !== undefined && pages < 10; pages++) {
      const page = await json(await w.get(path));
      seen.push(...page['features'].map((f: { id: string }) => f.id));
      const n = page['links'].find((l: { rel: string }) => l.rel === 'next');
      path = n === undefined ? undefined : n.href.replace('http://x/api/p/trees/ogc', '');
    }
    expect(new Set(seen).size).toBe(seen.length);
    for (const id of [IDS.t_in, IDS.t_hole, IDS.t_out]) expect(seen.filter((s) => s === id)).toHaveLength(1);
  });
});
