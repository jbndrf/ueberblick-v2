// WP-362 (E-9): GET features/<id>/history. One test or more per acceptance item.
import type { Json } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import type { Principal } from '../../auth/contract';
import { IDS, anna, seedMusterstadt, vera } from '../../store/run/testkit';
import { createAdminFeatureHandlers, type HistoryPage } from './index';
import { world, writeDeps } from './testkit';

const tree: Record<string, Json> = {
  vitalitaet: 'v2',
  geometrie: { type: 'Point', coordinates: [7.1, 50.735] },
};
const history = async (w: ReturnType<typeof world>, id: string, q = ''): Promise<HistoryPage> =>
  (await w.handlers.history(hcall(w, id, q)).json()) as HistoryPage;
const hcall = (w: ReturnType<typeof world>, id: string, q = '', principal?: Principal | null) => ({
  ...w.call(`features/${id}/history${q}`, principal),
  params: { project: 'demo', feature: id },
});

function seed(w: ReturnType<typeof world>) {
  // one accepted update, one refused update (befund must change), one create
  const ok = w.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'Kronenpflege' }, IDS.t_in);
  expect(
    w.ctx.store.submit(w.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'unauffällig' }, IDS.t_in))
      .outcome,
  ).toBe('refused');
  expect(w.ctx.store.submit(ok).outcome).toBe('accepted');
  return ok;
}

describe('admin feature history: content', () => {
  it('lists accepted and refused runs of the feature, newest first, with observations and refusal', async () => {
    const w = world();
    seedMusterstadt(w.ctx);
    const ok = seed(w);
    const page = await history(w, IDS.t_in);
    const [first, second] = page.runs;
    expect(page.next).toBeNull();
    expect(first?.id).toBe(ok.id);
    expect(first?.outcome).toBe('accepted');
    expect(first?.task).toBe('kontrolle');
    expect(first?.actor).toEqual({ id: 'anna', kind: 'participant', name: null });
    expect(first?.configVersion).toBe(1);
    expect(first?.observations.find((o) => o.property === 'befund')?.result).toBe('Kronenpflege');
    expect(second?.outcome).toBe('refused');
    expect(second?.refusal?.message).toContain('Befund muss sich ändern');
    expect(second?.observations).toEqual([]);
  });

  it('shows an accepted create run on the created feature', async () => {
    const w = world();
    const run = w.ctx.run('erfassen', vera, tree);
    const r = w.ctx.store.submit(run);
    if (r.outcome !== 'accepted') throw new Error('refused');
    const id = r.observations.find((o) => o.property === '$type')?.featureId as string;
    const page = await history(w, id);
    expect(page.runs.map((x) => x.id)).toEqual([run.id]);
    expect(page.runs[0]?.observations.map((o) => o.property)).toContain('$type');
  });

  it('includes a feature in every lifecycle state, gelöscht too', async () => {
    const w = world();
    const run = w.ctx.run('erfassen', vera, tree);
    const r = w.ctx.store.submit(run);
    if (r.outcome !== 'accepted') throw new Error('refused');
    const id = r.observations.find((o) => o.property === '$type')?.featureId as string;
    for (const state of ['active', 'completed', 'archived', 'deleted']) {
      w.db.prepare('UPDATE features SET lifecycle = ? WHERE id = ?').run(state, id);
      expect((await history(w, id)).runs).toHaveLength(1);
    }
  });

  it('answers 404 for an unknown feature and 400 for a bad cursor or parameter', async () => {
    const w = world();
    expect(w.handlers.history(hcall(w, 'nope')).status).toBe(404);
    expect(w.handlers.history(hcall(w, IDS.t_in, '?cursor=abc')).status).toBe(400);
    expect(w.handlers.history(hcall(w, IDS.t_in, '?x=1')).status).toBe(400);
  });
});

describe('admin feature history: access', () => {
  it('is admin only: the authorisation answer is returned as it is (401, 403)', () => {
    for (const status of [401, 403]) {
      const w = world();
      const handlers = createAdminFeatureHandlers({
        authorizeAdmin: () => new Response('no', { status }),
        db: () => w.db,
        deployed: () => undefined,
        ...writeDeps(w.ctx),
      });
      expect(handlers.history(hcall(w, IDS.t_in)).status).toBe(status);
    }
    const w = world();
    expect(w.handlers.history(hcall(w, IDS.t_in, '', null)).status).toBe(401);
  });

  it('reads the database of the authorised project only', async () => {
    const a = world();
    const b = world();
    const run = a.ctx.run('erfassen', vera, tree);
    const r = a.ctx.store.submit(run);
    if (r.outcome !== 'accepted') throw new Error('refused');
    const id = r.observations.find((o) => o.property === '$type')?.featureId as string;
    const handlers = createAdminFeatureHandlers({
      authorizeAdmin: (_p, key) => ({ projectKey: key }),
      db: (key) => (key === 'a' ? a.db : b.db),
      deployed: () => undefined,
      ...writeDeps(a.ctx),
    });
    const ask = (key: string) =>
      handlers.history({ ...a.call(`features/${id}/history`), params: { project: key, feature: id } });
    expect(ask('a').status).toBe(200);
    expect(ask('b').status).toBe(404);
  });
});

describe('admin feature history: keyset paging', () => {
  it('pages without repeats or skips, newest first, while runs are added between pages', async () => {
    const w = world();
    seedMusterstadt(w.ctx);
    const expected: string[] = [];
    for (let i = 0; i < 12; i++) {
      const run = w.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: `b${i}` }, IDS.t_in);
      expect(w.ctx.store.submit(run).outcome).toBe('accepted');
      expected.unshift(run.id);
    }
    const seen: string[] = [];
    let next: string | null = null;
    let n = 100;
    do {
      const url: string = next === null ? '' : `?cursor=${next}`;
      const page: HistoryPage = (await w.handlers.history(hcall(w, IDS.t_in, url)).json()) as HistoryPage;
      seen.push(...page.runs.map((r) => r.id));
      next = page.next;
      // runs written while paging land before the cursor's page and never disturb the older ones
      w.ctx.store.submit(w.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: `n${n++}` }, IDS.t_in));
      if (seen.length >= 50) break;
    } while (next !== null);
    for (const id of expected) expect(seen.filter((x) => x === id)).toHaveLength(1);
    expect(new Set(seen).size).toBe(seen.length);
    // the original runs keep their newest-first order
    expect(seen.filter((x) => expected.includes(x))).toEqual(expected);
  });

  it('returns at most 50 runs per page', async () => {
    const w = world();
    seedMusterstadt(w.ctx);
    for (let i = 0; i < 53; i++)
      w.ctx.store.submit(w.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: `b${i}` }, IDS.t_in));
    const page = await history(w, IDS.t_in);
    expect(page.runs).toHaveLength(50);
    expect(page.next).not.toBeNull();
    const rest = await history(w, IDS.t_in, `?cursor=${page.next}`);
    expect(rest.runs).toHaveLength(3);
    expect(rest.next).toBeNull();
  });
});
