import { describe, expect, it } from 'vitest';
import type { TemplateFile } from '@ueberblick/core';
import type { Principal } from '../../auth/contract';
import { SESSION_COOKIES } from '../../auth/params';
import { golden } from '../../store/run/testkit';
import { fakeUpstream, kit, ok, png } from '../../tiles/testkit';
import { createTileHandlers } from './handlers';

const ROLES: Record<string, string[]> = { kontrolle: ['kontrolle'], verwaltung: ['verwaltung'] };

function file(): TemplateFile {
  const f = structuredClone(golden('musterstadt-plain').file);
  f.map = {
    layers: {
      osm: { label: { de: 'OSM' }, kind: 'base', source: { type: 'preset', preset: 'osm' } },
      flur: {
        label: { de: 'Flur' },
        kind: 'overlay',
        roles: ['verwaltung'],
        source: { type: 'xyz', url: 'https://flur.example/{z}/{x}/{y}.png' },
      },
      amt: {
        label: { de: 'Amt' },
        kind: 'overlay',
        source: { type: 'wms', url: 'https://wms.example/ows', layers: 'a,b', version: '1.1.1' },
      },
      eigen: {
        label: { de: 'Eigen' },
        kind: 'overlay',
        source: { type: 'xyz', url: '/tiles/{z}/{x}/{y}.png' },
      },
      eigenpm: {
        label: { de: 'Eigen PM' },
        kind: 'overlay',
        source: { type: 'pmtiles', url: '/tiles/a.pmtiles' },
      },
      eigenwms: {
        label: { de: 'Eigen WMS' },
        kind: 'overlay',
        source: { type: 'wms', url: '/ows', layers: 'a' },
      },
      fremd: {
        label: { de: 'Fremd' },
        kind: 'overlay',
        source: { type: 'xyz', url: '//evil.example/{z}/{x}/{y}.png' },
      },
      daten: {
        label: { de: 'Daten' },
        kind: 'overlay',
        source: { type: 'geojson', url: 'https://x.example/a.json' },
      },
    },
  };
  return f;
}

function world(
  answers: Parameters<typeof fakeUpstream>[0] = () => ok(png('tile')),
  config: () => TemplateFile = file,
) {
  const up = fakeUpstream(answers);
  const { service } = kit(up);
  const handlers = createTileHandlers({
    auth: {
      authenticate: (id: string | null) =>
        id === null || !(id in ROLES)
          ? null
          : ({ kind: 'participant', id, projectId: 'p1' } as unknown as Principal),
      toActor: (p: { id: string }) => ({ id: p.id, kind: 'participant', roles: ROLES[p.id] ?? [] }),
      rolesFor: () => [],
    } as never,
    project: (key) => (key === 'demo' ? { id: 'p1', key } : undefined),
    deployed: () => ({ version: 1, config: { file: config() } as never }),
    service,
  });
  const get = (path: string, as: string | null, headers: Record<string, string> = {}) =>
    new Request(`http://x/api/p/demo/${path}`, {
      headers: {
        ...(as === null
          ? {}
          : {
              cookie: Object.values(SESSION_COOKIES)
                .map((name) => `${name}=${as}`)
                .join('; '),
            }),
        ...headers,
      },
    });
  const tile = (layer: string, as: string | null, zxy = '3/4/5', headers?: Record<string, string>) => {
    const [z = '', x = '', y = ''] = zxy.split('/');
    return handlers.tile(get(`tiles/${layer}/${zxy}`, as, headers), {
      params: { project: 'demo', layer, z, x, y },
    });
  };
  const wms = (layer: string, query: string, as: string | null = 'verwaltung') =>
    handlers.wms(get(`wms/${layer}?${query}`, as), { params: { project: 'demo', layer } });
  return { up, tile, wms };
}

describe('GET tiles/<layer>/<z>/<x>/<y>', () => {
  it.each([
    ['public, s-maxage=3600', 'private, max-age=3600'],
    ['public, max-age=60, s-maxage=3600', 'private, max-age=3600'],
    ['public, max-age=60', 'private, max-age=60'],
    ['no-cache', 'private, max-age=0'],
    ['no-store', 'private, max-age=0'],
    ['public, max-age=999999999', 'private, max-age=86400'],
  ])('caps the browser max-age by the upstream freshness (%s)', async (upstream, expected) => {
    const w = world(() => ok(png('tile'), { 'cache-control': upstream }));
    const r = await w.tile('osm', 'kontrolle');
    expect(r.headers.get('cache-control')).toBe(expected);
  });

  it('serves a tile with private caching headers and an etag, and answers 304 on a match', async () => {
    const w = world();
    const r = await w.tile('osm', 'kontrolle');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('cache-control')).toBe('private, max-age=86400');
    expect(r.headers.get('x-tile-cache')).toBe('MISS');
    expect(
      Buffer.from(await r.arrayBuffer())
        .subarray(8)
        .toString(),
    ).toBe('tile');
    expect(w.up.calls[0]?.url).toBe('https://tile.openstreetmap.org/3/4/5.png');
    const etag = r.headers.get('etag') ?? '';
    expect(etag).not.toBe('');
    const again = await w.tile('osm', 'kontrolle', '3/4/5', { 'if-none-match': etag });
    expect(again.status).toBe(304);
    expect(w.up.calls).toHaveLength(1);
  });

  it('401 without a session, and no upstream call', async () => {
    const w = world();
    expect((await w.tile('osm', null)).status).toBe(401);
    expect(w.up.calls).toHaveLength(0);
  });

  it('a hidden layer is 404, not 403, exactly like an unknown one; the audience sees it', async () => {
    const w = world();
    expect((await w.tile('flur', 'kontrolle')).status).toBe(404);
    expect((await w.tile('nix', 'kontrolle')).status).toBe(404);
    expect((await w.tile('flur', 'verwaltung')).status).toBe(200);
  });

  it('404 for a layer that has no tiles (geojson, wms) and for a tile outside the pyramid', async () => {
    const w = world();
    expect((await w.tile('daten', 'verwaltung')).status).toBe(404);
    expect((await w.tile('amt', 'verwaltung')).status).toBe(404);
    expect((await w.tile('osm', 'verwaltung', '2/4/0')).status).toBe(404); // x must be below 2^2
    expect((await w.tile('osm', 'verwaltung', '25/0/0')).status).toBe(404);
    expect((await w.tile('osm', 'verwaltung', '1/a/0')).status).toBe(404);
    expect(w.up.calls).toHaveLength(0);
  });

  it('a self-hosted layer (a path on this instance) is 404 not_proxied with no upstream call; `//host` is not a path', async () => {
    const w = world();
    for (const layer of ['eigen', 'eigenpm']) {
      const r = await w.tile(layer, 'verwaltung');
      expect(r.status).toBe(404);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('not_proxied');
    }
    const wms = await w.wms('eigenwms', 'bbox=0,0,1,1&width=10&height=10');
    expect(wms.status).toBe(404);
    expect(((await wms.json()) as { error: { code: string } }).error.code).toBe('not_proxied');
    expect(w.up.calls).toHaveLength(0);
    // `//evil.example/…` names a host, so it is not "self-hosted": it goes to the proxy and the guard refuses it.
    const fremd = await w.tile('fremd', 'verwaltung');
    expect(fremd.status).toBe(502);
    expect(((await fremd.json()) as { error: { code: string } }).error.code).toBe('upstream_failed');
    expect(w.up.calls).toHaveLength(0);
  });

  it('accepts the format as an ending of {y}', async () => {
    const w = world();
    expect((await w.tile('osm', 'verwaltung', '3/4/5.png')).status).toBe(200);
  });

  it('a tile the upstream does not have is 404 and nothing is kept', async () => {
    const w = world(() => undefined);
    expect((await w.tile('osm', 'verwaltung')).status).toBe(404);
    expect((await w.tile('osm', 'verwaltung')).status).toBe(404);
    expect(w.up.calls).toHaveLength(2);
  });

  it('an upstream that fails is 502 and nothing is kept', async () => {
    const w = world(() => new Response('x', { status: 500 }));
    const r = await w.tile('osm', 'verwaltung');
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('upstream_failed');
    expect(w.up.calls).toHaveLength(4);
    expect((await w.tile('osm', 'verwaltung')).headers.get('x-tile-cache')).toBeNull(); // asked again, not served from disk
    expect(w.up.calls).toHaveLength(8);
  });
});

describe('GET wms/<layer>', () => {
  const ok256 = 'bbox=1,2,3,4&width=256&height=256&crs=EPSG:3857';

  it('forwards only the declared parameters and drops every other query parameter (security)', async () => {
    const w = world();
    const r = await w.wms(
      'amt',
      `${ok256}&layers=secret&format=text/html&sld=http://evil.example/a.sld&sld_body=<x/>&token=1&service=WFS&request=GetFeatureInfo&styles=evil&version=9`,
    );
    expect(r.status).toBe(200);
    const q = new URL(w.up.calls[0]?.url ?? '').searchParams;
    expect([...q.keys()].sort()).toEqual(
      [
        'bbox',
        'format',
        'height',
        'layers',
        'request',
        'service',
        'srs',
        'styles',
        'transparent',
        'version',
        'width',
      ].sort(),
    );
    expect(q.get('layers')).toBe('a,b');
    expect(q.get('format')).toBe('image/png');
    expect(q.get('service')).toBe('WMS');
    expect(q.get('request')).toBe('GetMap');
    expect(q.get('version')).toBe('1.1.1');
    expect(q.get('styles')).toBe('');
    expect(q.get('srs')).toBe('EPSG:3857'); // 1.1.1 names the CRS `srs`
  });

  it('refuses a missing, malformed or oversized bbox and size with 400', async () => {
    const w = world();
    for (const bad of [
      'width=256&height=256',
      'bbox=1,2,3&width=256&height=256',
      'bbox=1,2,3,x&width=256&height=256',
      'bbox=1,2,3,4&width=0&height=256',
      'bbox=1,2,3,4&width=256&height=99999',
      'bbox=1,2,3,4&width=256&height=256&crs=EPSG:3857;drop',
      'bbox=1e99,2,3,4&width=256&height=256',
    ])
      expect((await w.wms('amt', bad)).status, bad).toBe(400);
    expect(w.up.calls).toHaveLength(0);
  });

  it('401 without a session; 404 for a layer that is not wms', async () => {
    const w = world();
    expect((await w.wms('amt', ok256, null)).status).toBe(401);
    expect((await w.wms('osm', ok256)).status).toBe(404);
  });
});

describe('the default base (v3 `default-osm`, WP-712)', () => {
  const overlaysOnly = (): TemplateFile => {
    const f = file();
    if (f.map !== undefined) delete (f.map.layers as Record<string, unknown>)['osm'];
    return f;
  };
  const noMap = (): TemplateFile => {
    const f = file();
    delete f.map;
    return f;
  };

  it('a project without a base layer gets the OSM tile through the same upstream and cache path as preset osm', async () => {
    const w = world(undefined, overlaysOnly);
    const r = await w.tile('default-osm', 'kontrolle');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-tile-cache')).toBe('MISS');
    expect(w.up.calls[0]?.url).toBe('https://tile.openstreetmap.org/3/4/5.png');
    const again = await w.tile('default-osm', 'kontrolle');
    expect(again.headers.get('x-tile-cache')).toBe('HIT');
    expect(w.up.calls).toHaveLength(1);
  });

  it('a project without a map section gets it too; 401 without a session', async () => {
    const w = world(undefined, noMap);
    expect((await w.tile('default-osm', 'kontrolle')).status).toBe(200);
    expect((await w.tile('default-osm', null)).status).toBe(401);
  });

  it('a project that declares a base layer answers 404 and fetches nothing', async () => {
    const w = world();
    expect((await w.tile('default-osm', 'kontrolle')).status).toBe(404);
    expect(w.up.calls).toHaveLength(0);
  });

  it('a base layer the caller does not see does not count: the caller gets the default', async () => {
    const hidden = (): TemplateFile => {
      const f = overlaysOnly();
      (f.map?.layers as Record<string, unknown>)['intern'] = {
        label: { de: 'Intern' },
        kind: 'base',
        roles: ['verwaltung'],
        source: { type: 'preset', preset: 'osm_de' },
      };
      return f;
    };
    const w = world(undefined, hidden);
    expect((await w.tile('default-osm', 'kontrolle')).status).toBe(200);
    expect((await w.tile('default-osm', 'verwaltung')).status).toBe(404);
  });
});
