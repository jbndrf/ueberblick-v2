/** WP-402 (Q18, A-043): a participant, by cookie or API token, writes through OGC Part 4 under their own permissions. */
import type { Key } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import { isAuthError } from '../../auth';
import { IDS } from '../../store/run/testkit';
import { ogcWorld, type OgcWorld } from './testkit';

const NO_COOKIE = '';
const tokenFor = (w: OgcWorld, who: string): Record<string, string> => {
  const issued = w.auth.apiTokens.issue('p1', who, { label: 'QGIS' });
  if (isAuthError(issued)) throw new Error(issued.code);
  return { authorization: `Bearer ${issued.token}` };
};
const runs = (w: OgcWorld) =>
  w.ctx.db
    .prepare<{ task: string; actor: string; actor_kind: string; outcome: string }>(
      'SELECT task, actor, actor_kind, outcome FROM runs WHERE actor_kind != ? ORDER BY rowid',
    )
    .all('import');
const accepted = (w: OgcWorld) => runs(w).filter((r) => r.outcome === 'accepted');
interface Err {
  error: { code: string; message: string; issues?: { path: string }[] };
}
const err = async (r: Response): Promise<Err['error']> => ((await r.json()) as Err).error;
const point = (x: number, y: number) => ({ type: 'Point', coordinates: [x, y] });
const tree = {
  type: 'Feature',
  geometry: point(7.1, 50.73),
  properties: { vitalitaet: 'v2' },
};
const baum = (id: string = IDS.t_in): string => `/collections/baum/items/${id}`;
const props = async (w: OgcWorld, path: string) =>
  ((await (await w.get(path)).json()) as { properties: Record<string, unknown> }).properties;
const patch = (properties: Record<string, unknown>, geometry: unknown = null) => ({
  type: 'Feature',
  geometry,
  properties,
});

describe('participant writes through OGC (WP-402)', () => {
  it('a token creates an item their role may create, as one run of actor kind participant', async () => {
    const w = await ogcWorld();
    const r = await w.send('POST', '/collections/baum/items', tree, NO_COOKIE, tokenFor(w, 'anna'));
    expect(r.status).toBe(201);
    expect(runs(w)).toEqual([
      { task: 'erfassen', actor: 'anna', actor_kind: 'participant', outcome: 'accepted' },
    ]);
    const location = (r.headers.get('location') ?? '').replace('http://x/api/p/trees/ogc', '');
    expect((await w.get(location)).status).toBe(200);
  });

  it('a cookie session works the same way', async () => {
    const w = await ogcWorld();
    expect((await w.send('POST', '/collections/baum/items', tree, w.cookies.anna)).status).toBe(201);
    expect(runs(w)[0]).toMatchObject({ actor: 'anna', actor_kind: 'participant' });
  });

  it('PATCH goes through the unique task the participant may run', async () => {
    const w = await ogcWorld();
    const r = await w.send(
      'PATCH',
      baum(),
      patch({}, point(7.1031, 50.7331)),
      NO_COOKIE,
      tokenFor(w, 'anna'),
    );
    expect(r.status).toBe(204);
    expect(runs(w).at(-1)).toMatchObject({ task: 'verschieben', actor_kind: 'participant', actor: 'anna' });
  });

  it('refuses a task the participant may not run: 403, the reason, nothing written', async () => {
    const w = await ogcWorld();
    const auth = tokenFor(w, 'anna');
    const species = patch({ name_de: 'Eiche' });
    const r = await w.send('POST', '/collections/baumart/items', species, NO_COOKIE, auth);
    expect(r.status).toBe(403);
    const e = await err(r);
    expect(e.code).toBe('forbidden');
    expect(e.message.length).toBeGreaterThan(10);
    expect(e.issues?.[0]?.path).toBeTruthy();
    // an explicit ?task= does not widen it
    const hinted = await w.send(
      'POST',
      '/collections/baumart/items?task=baumart_anlegen',
      species,
      NO_COOKIE,
      auth,
    );
    expect(hinted.status).toBe(403);
    expect(accepted(w)).toEqual([]);
    const list = (await (await w.get('/collections/baumart/items')).json()) as { features: unknown[] };
    expect(list.features).toHaveLength(1); // the seeded Linde only
  });

  it('refuses a role the task `who` does not admit (bauhof may not run the task): 403 with the `who` path, the feature is unchanged', async () => {
    const w = await ogcWorld({ annaRoles: ['bauhof' as Key] });
    const before = await props(w, baum());
    const r = await w.send(
      'PATCH',
      `${baum()}?task=befund_ergaenzen`,
      patch({ befund: 'Schaden' }),
      NO_COOKIE,
      tokenFor(w, 'anna'),
    );
    expect(r.status).toBe(403);
    expect((await err(r)).issues?.[0]?.path).toBe('who');
    expect(await props(w, baum())).toEqual(before);
    expect(accepted(w)).toEqual([]);
  });

  it('a property the task form does not carry cannot be smuggled in, nor can a system key', async () => {
    const w = await ogcWorld();
    const auth = tokenFor(w, 'anna');
    for (const extra of [{ zustaendig: 'mallory' }, { $lifecycle: 'deleted' }, { stage: 'erledigt' }]) {
      const r = await w.send(
        'PATCH',
        `${baum()}?task=befund_ergaenzen`,
        patch({ befund: 'neu', ...extra }),
        NO_COOKIE,
        auth,
      );
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
    const p = await props(w, baum());
    expect(p['zustaendig']).toBe('anna');
    expect(p['stage']).toBe('erfasst');
    expect(accepted(w)).toEqual([]);
  });

  it('a participant may not delete through a task they cannot run', async () => {
    const w = await ogcWorld({ annaRoles: ['bauhof' as Key] });
    const r = await w.send('DELETE', baum(), undefined, w.cookies.anna);
    expect([403, 422]).toContain(r.status);
    expect((await w.get(baum())).status).toBe(200);
  });

  it('a type the participant cannot see is refused for writes', async () => {
    const w = await ogcWorld({ annaRoles: ['nobody' as Key] });
    const r = await w.send('POST', '/collections/baumart/items', patch({ name_de: 'x' }), w.cookies.anna);
    expect(r.status).toBe(403);
    expect(accepted(w)).toEqual([]);
  });

  it('a role closed out by the task `when` is 403 on an existing feature too', async () => {
    const w = await ogcWorld({ annaRoles: ['bauhof' as Key] });
    const r = await w.send('PATCH', baum(), patch({}, point(7, 50)), w.cookies.anna);
    expect(r.status).toBe(403);
    expect(accepted(w)).toEqual([]);
  });

  it('rules and computed values react as in the app', async () => {
    const w = await ogcWorld();
    const r = await w.send(
      'PATCH',
      `${baum()}?task=kontrolle`,
      patch({ vitalitaet: 'v4', befund: 'Pilzbefall', hoehe_m: 30 }),
      NO_COOKIE,
      tokenFor(w, 'anna'),
    );
    expect(r.status).toBe(204);
    const p = await props(w, baum());
    expect(p['stage']).toBe('massnahme'); // the task's `then`
    expect(p['hoehe_klasse']).toBe('gross'); // computed
    const tasks = runs(w).map((x) => x.task);
    expect(tasks).toContain('kontrolle');
    expect(runs(w).find((x) => x.task === 'kontrolle')?.actor_kind).toBe('participant');
    const measures = (await (await w.get('/collections/massnahme/items')).json()) as { features: unknown[] };
    expect(measures.features.length).toBeGreaterThan(0); // the rule's run created the measure
  });

  it('an admin still writes as admin', async () => {
    const w = await ogcWorld();
    const r = await w.send('POST', '/collections/baumart/items', patch({ name_de: 'Eiche' }));
    expect(r.status).toBe(201);
    expect(runs(w)).toEqual([
      { task: 'baumart_anlegen', actor: expect.any(String), actor_kind: 'admin', outcome: 'accepted' },
    ]);
  });

  it('a revoked token writes nothing', async () => {
    const w = await ogcWorld();
    const issued = w.auth.apiTokens.issue('p1', 'anna', { label: 'x' });
    if (isAuthError(issued)) throw new Error(issued.code);
    w.auth.apiTokens.revoke('p1', issued.info.id);
    const r = await w.send('POST', '/collections/baum/items', tree, NO_COOKIE, {
      authorization: `Bearer ${issued.token}`,
    });
    expect(r.status).toBe(401);
    expect(runs(w)).toEqual([]);
  });
});
