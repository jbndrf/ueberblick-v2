// WP-370 (E-11): POST features/<id>/correct, the 'Admin-Korrektur' of the data page.
import type { Json } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import type { Principal } from '../../auth/contract';
import { IDS, anna, seedMusterstadt } from '../../store/run/testkit';
import type { HistoryPage } from './index';
import { world } from './testkit';

const tree = IDS.t_in;
const post = (
  w: ReturnType<typeof world>,
  id: string,
  body: unknown,
  principal?: Principal | null,
): Promise<Response> | Response =>
  w.handlers.correct({
    ...w.call(`features/${id}/correct`, principal),
    request: new Request(`http://x/api/admin/p/demo/features/${id}/correct`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params: { project: 'demo', feature: id },
  });
const runCount = (w: ReturnType<typeof world>): number =>
  (
    w.db
      .prepare<{ n: number }>(
        "SELECT COUNT(*) AS n FROM runs WHERE task = '$correct' AND outcome = 'accepted'",
      )
      .get() as {
      n: number;
    }
  ).n;
const seqOf = (w: ReturnType<typeof world>): number =>
  (
    w.db.prepare<{ s: number }>('SELECT updated_seq AS s FROM features WHERE id = ?').get(tree) as {
      s: number;
    }
  ).s;
const ready = () => {
  const w = world();
  seedMusterstadt(w.ctx);
  return w;
};

describe('admin correct', () => {
  it('one call with 3 values yields exactly one run, in the history under the admin', async () => {
    const w = ready();
    const res = await post(w, tree, { values: { befund: 'Pilzbefall', hoehe_m: 12, vitalitaet: 'v3' } });
    expect(res.status).toBe(200);
    expect(runCount(w)).toBe(1);
    const body = (await res.json()) as { runId: string; seq: number };
    expect(body.seq).toBe(seqOf(w));
    const hres = await w.handlers.history({
      ...w.call(`features/${tree}/history`),
      params: { project: 'demo', feature: tree },
    });
    const first = ((await hres.json()) as HistoryPage).runs[0];
    expect(first?.id).toBe(body.runId);
    expect(first?.task).toBe('$correct');
    expect(first?.actor).toEqual({ id: 'a1', kind: 'admin', name: 'Admin Eins' });
    expect(Object.fromEntries((first?.observations ?? []).map((o) => [o.property, o.result]))).toEqual({
      befund: 'Pilzbefall',
      hoehe_m: 12,
      vitalitaet: 'v3',
    });
    const row = (await w.list('')).rows.find((r) => r.$id === tree);
    expect(row?.['befund']).toBe('Pilzbefall');
  });

  it('refuses a bad value with 422 and the path of the value, and writes no observation', async () => {
    const w = ready();
    const before = seqOf(w);
    const res = await post(w, tree, { values: { befund: 'ok', hoehe_m: 'hoch' } });
    expect(res.status).toBe(422);
    const err = ((await res.json()) as { error: { code: string; issues: { path: string }[] } }).error;
    expect(err.code).toBe('run_refused');
    expect(err.issues[0]?.path).toBe('input.values.hoehe_m');
    expect(seqOf(w)).toBe(before);
  });

  it('refuses the stage', async () => {
    const w = ready();
    const res = await post(w, tree, { values: { stage: 'massnahme' } });
    expect(res.status).toBe(422);
    expect(JSON.stringify(await res.json())).toContain('input.values.stage');
  });

  it('401, 403 and 404 come from the admin check and the feature', async () => {
    const w = ready();
    expect((await post(w, tree, { values: { befund: 'x' } }, null)).status).toBe(401);
    const participant = { kind: 'participant', id: anna.id } as unknown as Principal;
    expect((await post(w, tree, { values: { befund: 'x' } }, participant)).status).toBe(403);
    expect((await post(w, 'nope', { values: { befund: 'x' } })).status).toBe(404);
    expect(runCount(w)).toBe(0);
  });

  it('400 for a body that is no { values } object', async () => {
    const w = ready();
    expect((await post(w, tree, 'not json')).status).toBe(400);
    expect((await post(w, tree, { values: [1] })).status).toBe(400);
    expect((await post(w, tree, { values: {}, expected_seq: 'x' as unknown as Json })).status).toBe(400);
  });

  it('a stale expected_seq is refused with 409 and writes nothing; the current one passes', async () => {
    const w = ready();
    const seq = seqOf(w);
    const stale = await post(w, tree, { values: { befund: 'x' }, expected_seq: seq - 1 });
    expect(stale.status).toBe(409);
    expect(runCount(w)).toBe(0);
    const ok = await post(w, tree, { values: { befund: 'x' }, expected_seq: seq });
    expect(ok.status).toBe(200);
    expect(seqOf(w)).toBeGreaterThan(seq);
  });

  it('one row can be read again by its id, whatever its lifecycle (what the table does after a save)', async () => {
    const w = ready();
    const page = await w.list(`filter.%24id=${tree}&lifecycle=active,completed,archived,deleted`);
    expect(page.rows.map((r) => r.$id)).toEqual([tree]);
  });

  it('the list rows carry the Objekt seq for that check', async () => {
    const w = ready();
    const row = (await w.list('')).rows.find((r) => r.$id === tree);
    expect(row?.$seq).toBe(seqOf(w));
  });
});
