// WP-382 (E-12, E-13): POST features (a new row of a Tabelle, one `$create` run) and POST features/<id>/lifecycle (delete, one `$lifecycle` run).
import { describe, expect, it } from 'vitest';
import type { Principal } from '../../auth/contract';
import { anna, seedMusterstadt } from '../../store/run/testkit';
import { world } from './testkit';

type W = ReturnType<typeof world>;
const ADMIN_ACTOR = { id: 'a1', kind: 'admin' };

const postCreate = (w: W, body: unknown, principal?: Principal | null): Promise<Response> | Response =>
  w.handlers.create({
    ...w.call('features', principal),
    request: new Request('http://x/api/admin/p/demo/features', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  });
const postLifecycle = (
  w: W,
  id: string,
  body: unknown,
  principal?: Principal | null,
): Promise<Response> | Response =>
  w.handlers.lifecycle({
    ...w.call(`features/${id}/lifecycle`, principal),
    request: new Request(`http://x/api/admin/p/demo/features/${id}/lifecycle`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    params: { project: 'demo', feature: id },
  });
const runs = (w: W, task: string): { actor_kind: string; feature_id: string }[] =>
  w.db
    .prepare<{ actor_kind: string; feature_id: string }>(
      "SELECT actor_kind, feature_id FROM runs WHERE task = ? AND outcome = 'accepted' ORDER BY rowid",
    )
    .all(task);
const ready = (): W => {
  const w = world();
  seedMusterstadt(w.ctx);
  return w;
};

describe('admin create', () => {
  it('one call is one $create run by the admin; the new row is in the table with its values', async () => {
    const w = ready();
    const res = await postCreate(w, { type: 'baumart', values: { name_de: 'Eiche', name_lat: 'Quercus' } });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { runId: string; id: string };
    expect(runs(w, '$create')).toEqual([{ actor_kind: ADMIN_ACTOR.kind, feature_id: body.id }]);
    const row = w.db
      .prepare<{ properties: string; type: string; created_by: string }>(
        'SELECT properties, type, created_by FROM features WHERE id = ?',
      )
      .get(body.id);
    expect(row?.type).toBe('baumart');
    expect(row?.created_by).toBe('a1');
    expect(JSON.parse(row?.properties ?? '{}')).toEqual({ name_de: 'Eiche', name_lat: 'Quercus' });
  });

  it('refuses a missing required value with 422 and writes nothing', async () => {
    const w = ready();
    const res = await postCreate(w, { type: 'baumart', values: { name_lat: 'x' } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('name_de');
    expect(runs(w, '$create')).toHaveLength(0);
  });

  it('refuses a bad value with the path of the value', async () => {
    const w = ready();
    const res = await postCreate(w, { type: 'baumart', values: { name_de: 5 } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('input.values.name_de');
  });

  it('401, 403 from the admin check, 404 for an unknown type, 400 for a bad body', async () => {
    const w = ready();
    const body = { type: 'baumart', values: { name_de: 'x' } };
    expect((await postCreate(w, body, null)).status).toBe(401);
    const participant = { kind: 'participant', id: anna.id } as unknown as Principal;
    expect((await postCreate(w, body, participant)).status).toBe(403);
    expect((await postCreate(w, { type: 'gibtsnicht', values: {} })).status).toBe(404);
    expect((await postCreate(w, 'not json')).status).toBe(400);
    expect((await postCreate(w, { values: {} })).status).toBe(400);
    expect(runs(w, '$create')).toHaveLength(0);
  });
});

describe('admin lifecycle', () => {
  const linde = (w: W): string =>
    (
      w.db.prepare<{ id: string }>("SELECT id FROM features WHERE type = 'baumart' LIMIT 1").get() as {
        id: string;
      }
    ).id;

  it('deleting is one $lifecycle run; the row leaves the default list', async () => {
    const w = ready();
    const id = linde(w);
    const res = await postLifecycle(w, id, { state: 'deleted' });
    expect(res.status).toBe(200);
    expect(runs(w, '$lifecycle')).toEqual([{ actor_kind: 'admin', feature_id: id }]);
    const life = w.db.prepare<{ lifecycle: string }>('SELECT lifecycle FROM features WHERE id = ?').get(id);
    expect(life?.lifecycle).toBe('deleted');
  });

  it('refuses a state that is none, an unknown Objekt and a non-admin', async () => {
    const w = ready();
    const id = linde(w);
    expect((await postLifecycle(w, id, { state: 'weg' })).status).toBe(400);
    expect((await postLifecycle(w, 'nope', { state: 'deleted' })).status).toBe(404);
    expect((await postLifecycle(w, id, { state: 'deleted' }, null)).status).toBe(401);
    expect(runs(w, '$lifecycle')).toHaveLength(0);
  });
});
