import type { Key } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { IDS, build, golden } from '../../store/run/testkit';
import { ogcWorld } from './testkit';

const json = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const ids = (fc: Record<string, any>): string[] => fc['features'].map((f: { id: string }) => f.id).sort(); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('landing page, conformance, collections', () => {
  it('needs a session and a project membership', async () => {
    const w = await ogcWorld();
    expect((await w.get('/', '')).status).toBe(401);
    expect((await w.get('/', w.cookies.stranger)).status).toBe(403);
  });

  it('the landing page links itself, the conformance declaration and the collections', async () => {
    const w = await ogcWorld();
    const r = await w.get('/');
    expect(r.status).toBe(200);
    const body = await json(r);
    const rels = Object.fromEntries(body['links'].map((l: { rel: string; href: string }) => [l.rel, l.href]));
    expect(rels['self']).toBe('http://x/api/p/trees/ogc');
    expect(rels['conformance']).toBe('http://x/api/p/trees/ogc/conformance');
    expect(rels['data']).toBe('http://x/api/p/trees/ogc/collections');
  });

  it('conformance claims Core, GeoJSON, CRS, filter (CQL2) and Part 4', async () => {
    const w = await ogcWorld();
    const c = (await json(await w.get('/conformance')))['conformsTo'] as string[];
    expect(c).toContain('http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core');
    expect(c).toContain('http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson');
    expect(c).toContain('http://www.opengis.net/spec/ogcapi-features-4/1.0/conf/create-replace-delete');
    expect(c).toContain('http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter');
    expect(c).toContain('http://www.opengis.net/spec/cql2/1.0/conf/cql2-json');
    expect(c).toContain('http://www.opengis.net/spec/ogcapi-features-2/1.0/conf/crs');
  });

  it('collections are the feature types the principal can see, with items links', async () => {
    const w = await ogcWorld();
    const body = await json(await w.get('/collections'));
    const keys = body['collections'].map((c: { id: string }) => c.id).sort();
    expect(keys).toEqual(['baum', 'baumart', 'flaeche', 'massnahme']);
    const baum = body['collections'].find((c: { id: string }) => c.id === 'baum');
    expect(baum.title).toBe('Baum');
    expect(baum.itemType).toBe('feature');
    expect(
      baum.links.some(
        (l: { rel: string; href: string }) => l.rel === 'items' && l.href.endsWith('/collections/baum/items'),
      ),
    ).toBe(true);
  });

  it('a type nobody may see is not a collection (and 404 on its items)', async () => {
    const w = await ogcWorld({ scoped: true });
    // anna (kontrolle) sees baum (row filter) but the endpoint still lists it; the row filter clips items, not the type
    expect((await w.get('/collections/unknown')).status).toBe(404);
    expect((await w.get('/collections/unknown/items')).status).toBe(404);
  });
});

describe('names that are not collections', () => {
  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])(
    '%s is 404, also its items',
    async (name) => {
      const w = await ogcWorld();
      for (const path of [
        `/collections/${name}`,
        `/collections/${name}/items`,
        `/collections/${name}/items/x`,
      ]) {
        const r = await w.get(path);
        expect(r.status).toBe(404);
        expect((await json(r))['error']['code']).toBe('not_found');
      }
      expect(
        (await w.get(`/collections/baum/items?filter=${encodeURIComponent(`${name}='x'`)}`)).status,
      ).toBe(400);
    },
  );
});

describe('items', () => {
  it('returns GeoJSON features: id, primary geometry, other properties', async () => {
    const w = await ogcWorld();
    const r = await w.get('/collections/baum/items');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('application/geo+json');
    const fc = await json(r);
    expect(fc['type']).toBe('FeatureCollection');
    expect(ids(fc)).toEqual([IDS.t_hole, IDS.t_in, IDS.t_out].sort());
    const tin = fc['features'].find((f: { id: string }) => f.id === IDS.t_in);
    expect(tin.type).toBe('Feature');
    expect(tin.geometry).toEqual({ type: 'Point', coordinates: [7.102, 50.732] });
    expect(tin.properties.vitalitaet).toBe('v2');
    expect(tin.properties).not.toHaveProperty('geometrie');
    expect(fc['numberReturned']).toBe(3);
  });

  it('clips rows by the permission predicate of the sync scope, never a second filter', async () => {
    const w = await ogcWorld({ scoped: true });
    const anna = await json(await w.get('/collections/baum/items', w.cookies.anna));
    expect(ids(anna)).toEqual([IDS.t_in]);
    const admin = await json(await w.get('/collections/baum/items'));
    expect(ids(admin)).toHaveLength(3);
    expect((await w.get(`/collections/baum/items/${IDS.t_out}`, w.cookies.anna)).status).toBe(404);
  });

  it('strips properties the actor may not read', async () => {
    const w = await ogcWorld({ annaRoles: ['bauhof' as Key] });
    w.ctx.change(IDS.t_in, { intern_notiz: 'geheim' });
    const anna = await json(await w.get(`/collections/baum/items/${IDS.t_in}`, w.cookies.anna));
    expect(anna['properties']).not.toHaveProperty('intern_notiz');
    const admin = await json(await w.get(`/collections/baum/items/${IDS.t_in}`));
    expect(admin['properties']['intern_notiz']).toBe('geheim');
  });

  it('bbox keeps the features whose bbox intersects (WGS84 lon/lat order)', async () => {
    const w = await ogcWorld();
    const fc = await json(await w.get('/collections/baum/items?bbox=7.1,50.73,7.11,50.74'));
    expect(ids(fc)).toEqual([IDS.t_hole, IDS.t_in].sort());
    const six = await json(await w.get('/collections/baum/items?bbox=7.1,50.73,0,7.11,50.74,100'));
    expect(ids(six)).toEqual(ids(fc));
  });

  it('pages with limit and a next link until the last page, without gaps or repeats', async () => {
    const w = await ogcWorld();
    const seen: string[] = [];
    let path: string | undefined = '/collections/baum/items?limit=1';
    let pages = 0;
    while (path !== undefined && pages++ < 10) {
      const fc = await json(await w.get(path));
      expect(fc['features'].length).toBeLessThanOrEqual(1);
      seen.push(...ids(fc));
      const next = fc['links'].find((l: { rel: string }) => l.rel === 'next');
      path = next === undefined ? undefined : next.href.replace('http://x/api/p/trees/ogc', '');
    }
    expect(seen.sort()).toEqual([IDS.t_hole, IDS.t_in, IDS.t_out].sort());
    expect(pages).toBe(3);
  });

  it('one item, and 404 for an unknown or deleted-looking id', async () => {
    const w = await ogcWorld();
    const r = await w.get(`/collections/baum/items/${IDS.t_in}`);
    expect(r.status).toBe(200);
    expect((await json(r))['id']).toBe(IDS.t_in);
    expect((await w.get(`/collections/flaeche/items/${IDS.t_in}`)).status).toBe(404);
    expect((await w.get('/collections/baum/items/nope')).status).toBe(404);
  });

  it.each([
    ['limit=0'],
    ['limit=100000'],
    ['limit=x'],
    ['bbox=1,2,3'],
    ['bbox=a,b,c,d'],
    ['bbox=7.2,50,7.1,51'],
    ['nonsense=1'],
    ['cursor=zzz'],
  ])('a bad query (%s) is a 400 in the error envelope', async (q) => {
    const w = await ogcWorld();
    const r = await w.get(`/collections/baum/items?${q}`);
    expect(r.status).toBe(400);
    expect((await json(r))['error']['code']).toBe('invalid_query');
  });

  it('a CRS the server does not offer, or a filter that does not fit the collection, is refused', async () => {
    const w = await ogcWorld();
    const r = await w.get('/collections/baum/items?crs=http://www.opengis.net/def/crs/EPSG/0/2056');
    expect(r.status).toBe(400);
    expect((await w.get("/collections/baum/items?filter=nope='v2'")).status).toBe(400);
    expect((await w.get('/collections/baum/items?filter-lang=sql&filter=x')).status).toBe(400);
    expect((await w.get('/collections/baum/items?filter=vitalitaet=')).status).toBe(400);
  });

  it('answers unknown routes with 404 and unsupported methods with 405', async () => {
    const w = await ogcWorld();
    expect((await w.get('/nothing')).status).toBe(404);
    expect((await w.send('POST', '/collections')).status).toBe(405);
  });
});

describe('Part 4 writes become runs', () => {
  const dump = (w: Awaited<ReturnType<typeof ogcWorld>>) =>
    w.ctx.db
      .prepare<{ task: string; actor_kind: string; outcome: string }>(
        'SELECT task, actor_kind, outcome FROM runs WHERE actor_kind != ? ORDER BY rowid',
      )
      .all('import');

  it('POST creates through the one task that creates the type, as actor kind admin', async () => {
    const w = await ogcWorld();
    const r = await w.send('POST', '/collections/baumart/items', {
      type: 'Feature',
      geometry: null,
      properties: { name_de: 'Eiche' },
    });
    expect(r.status).toBe(201);
    const location = r.headers.get('location') ?? '';
    expect(location).toMatch(/\/collections\/baumart\/items\/[0-9a-f-]{36}$/);
    expect(dump(w)).toEqual([{ task: 'baumart_anlegen', actor_kind: 'admin', outcome: 'accepted' }]);
    const made = await json(await w.get(location.replace('http://x/api/p/trees/ogc', '')));
    expect(made['properties']['name_de']).toBe('Eiche');
  });

  it('a refused run is a 422 with the refusal, and writes no feature', async () => {
    const w = await ogcWorld();
    const before = ids(await json(await w.get('/collections/baum/items')));
    const r = await w.send('POST', '/collections/baum/items', {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.1, 50.7] },
      properties: {},
    });
    expect(r.status).toBe(422);
    const e = (await json(r))['error'];
    expect(e.code).toBe('run_refused');
    expect(e.message).toMatch(/[a-z_]+:/);
    expect(ids(await json(await w.get('/collections/baum/items')))).toEqual(before);
    expect(dump(w).at(-1)?.outcome).toBe('rejected');
  });

  it('a participant may not write through the API (403); a bad body is a 400', async () => {
    const w = await ogcWorld();
    const body = { type: 'Feature', geometry: null, properties: { name_de: 'X' } };
    expect((await w.send('POST', '/collections/baumart/items', body, w.cookies.anna)).status).toBe(403);
    expect((await w.send('POST', '/collections/baumart/items', { nope: 1 })).status).toBe(400);
  });

  it('PATCH and PUT send only what changed, through the unique task the admin may run', async () => {
    const w = await ogcWorld();
    const moved = { type: 'Point', coordinates: [7.103, 50.733] };
    const r = await w.send('PATCH', `/collections/baum/items/${IDS.t_in}`, {
      type: 'Feature',
      geometry: moved,
      properties: {},
    });
    expect(r.status).toBe(204);
    expect((await json(await w.get(`/collections/baum/items/${IDS.t_in}`)))['geometry']).toEqual(moved);
    expect(dump(w).at(-1)).toEqual({ task: 'verschieben', actor_kind: 'admin', outcome: 'accepted' });
    // replace with the same content changes nothing and writes no run
    const n = dump(w).length;
    const same = await w.send('PUT', `/collections/baum/items/${IDS.t_in}`, {
      type: 'Feature',
      geometry: moved,
      properties: {},
    });
    expect(same.status).toBe(204);
    expect(dump(w)).toHaveLength(n);
  });

  it('no task covers the change: 422 that names the candidates; ?task= chooses explicitly', async () => {
    const w = await ogcWorld();
    const patch = { type: 'Feature', geometry: null, properties: { befund: 'neu' } };
    const r = await w.send('PATCH', `/collections/baum/items/${IDS.t_in}`, patch);
    expect(r.status).toBe(422);
    expect((await json(r))['error']['code']).toBe('no_write_task');
    const bad = await w.send('PATCH', `/collections/baum/items/${IDS.t_in}?task=nonexistent`, patch);
    expect(bad.status).toBe(422);
    const moved = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [7.104, 50.731] },
      properties: {},
    };
    expect(
      (await w.send('PATCH', `/collections/baum/items/${IDS.t_in}?task=verschieben`, moved)).status,
    ).toBe(204);
  });

  it('PATCH of an invisible or unknown feature is 404; DELETE without a delete task is 422', async () => {
    const w = await ogcWorld({ scoped: true });
    expect(
      (
        await w.send(
          'PATCH',
          `/collections/baum/items/${IDS.t_out}`,
          { type: 'Feature', geometry: null, properties: {} },
          w.cookies.stranger,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await w.send('PATCH', '/collections/baum/items/nope', {
          type: 'Feature',
          geometry: null,
          properties: {},
        })
      ).status,
    ).toBe(404);
    const d = await w.send('DELETE', `/collections/baum/items/${IDS.t_in}`);
    expect(d.status).toBe(422);
    expect((await json(d))['error']['code']).toBe('no_write_task');
    expect((await w.get(`/collections/baum/items/${IDS.t_in}`)).status).toBe(200);
  });
});

describe('DELETE with a configured delete task (WP-305)', () => {
  it('runs the task: the feature is deleted and no longer served', async () => {
    const file = structuredClone(golden('musterstadt-plain').file);
    file.tasks = {
      ...file.tasks,
      entfernen: { label: { de: 'Entfernen' }, on: 'baum', then: [{ lifecycle: 'deleted' }] },
    };
    const w = await ogcWorld({ config: build(file) });
    expect((await w.get(`/collections/baum/items/${IDS.t_in}`)).status).toBe(200);
    expect((await w.send('DELETE', `/collections/baum/items/${IDS.t_in}`)).status).toBe(204);
    expect((await w.get(`/collections/baum/items/${IDS.t_in}`)).status).toBe(404);
    const row = w.ctx.db
      .prepare<{ lifecycle: string }>('SELECT lifecycle FROM features WHERE id = ?')
      .get(IDS.t_in);
    expect(row?.lifecycle).toBe('deleted');
  });

  it.each([
    ['a set of the subject next to the delete', [{ set: { vitalitaet: "'v1'" } }, { lifecycle: 'deleted' }]],
    ['only steps with of', [{ lifecycle: 'deleted', of: 'self.massnahmen' }]],
    [
      'a set of the subject after a step with of',
      [{ lifecycle: 'deleted', of: 'self.massnahmen' }, { set: { vitalitaet: "'v1'" } }],
    ],
  ])('is not a delete task: %s (422 no_write_task)', async (_name, then) => {
    const file = structuredClone(golden('musterstadt-plain').file);
    const baum = file.types?.['baum'];
    if (baum === undefined) throw new Error('no baum');
    baum.relations = {
      ...baum.relations,
      massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum', cardinality: 'many' },
    };
    file.tasks = { ...file.tasks, entfernen: { label: { de: 'Entfernen' }, on: 'baum', then } as never };
    const w = await ogcWorld({ config: build(file) });
    const d = await w.send('DELETE', `/collections/baum/items/${IDS.t_in}`);
    expect(d.status).toBe(422);
    expect((await json(d))['error']['code']).toBe('no_write_task');
    expect((await w.get(`/collections/baum/items/${IDS.t_in}`)).status).toBe(200);
  });

  it('a delete task that also detaches the children (Kinder trennen, WP-371) is still the delete task', async () => {
    const file = structuredClone(golden('musterstadt-plain').file);
    const baum = file.types?.['baum'];
    if (baum === undefined) throw new Error('no baum');
    baum.relations = {
      ...baum.relations,
      massnahmen: { to: 'massnahme', inverse_of: 'massnahme.baum', cardinality: 'many' },
    };
    file.tasks = {
      ...file.tasks,
      entfernen: {
        label: { de: 'Entfernen' },
        on: 'baum',
        // steps with `of` act on the children; only the others decide whether this task is a delete task
        then: [{ set: { baum: null }, of: 'self.massnahmen' }, { lifecycle: 'deleted' }],
      },
    };
    const w = await ogcWorld({ config: build(file) });
    const kid = '00000000-0000-7000-8000-0000000000aa';
    w.ctx.seed([
      { id: kid as never, type: 'massnahme' as Key, properties: { baum: IDS.t_in, art: 'schnitt' } },
    ]);
    expect((await w.send('DELETE', `/collections/baum/items/${IDS.t_in}`)).status).toBe(204);
    const lifecycle = (id: string) =>
      w.ctx.db.prepare<{ lifecycle: string }>('SELECT lifecycle FROM features WHERE id = ?').get(id)
        ?.lifecycle;
    expect(lifecycle(IDS.t_in)).toBe('deleted');
    expect(lifecycle(kid)).toBe('active');
    const props = w.ctx.db
      .prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?')
      .get(kid)?.properties;
    expect((JSON.parse(props ?? '{}') as { baum?: unknown }).baum ?? null).toBeNull();
  });
});
