import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SESSION_PARTICIPANT_HEADER, SYNC_PROTOCOL_VERSION } from '@ueberblick/core';
import { world } from './runs.testkit';
import { uuid } from '../../store/run/testkit';
import { DEFAULT_HTTP_LIMITS } from '../shared';
import { BatchResponseSchema, RunResponseSchema } from './schema';

let n = 0;
const point = (x: number) => ({ type: 'Point', coordinates: [x, 50.735] });
const erfassen = (over: Record<string, unknown> = {}) => ({
  id: uuid(7, ++n),
  task: 'erfassen',
  configVersion: 1,
  input: { geometrie: point(7.1 + n * 0.0001), vitalitaet: 'v2' },
  ...over,
});
const count = (w: Awaited<ReturnType<typeof world>>, table: string): number =>
  (w.ctx.db.prepare<{ n: number }>(`SELECT count(*) n FROM ${table}`).get() as { n: number }).n;

describe('authentication and authorisation', () => {
  it('401 without a session, 403 for another project, an admin without membership and an unknown project', async () => {
    const w = await world();
    const anon = await w.call('submit', erfassen());
    expect(anon.status).toBe(401);
    expect(await anon.json()).toMatchObject({ error: { code: 'unauthenticated' } });
    for (const [cookie, project] of [
      [w.cookies.annaOther, 'trees'],
      [w.cookies.stranger, 'trees'],
      [w.cookies.anna, 'nowhere'],
      [w.cookies.anna, 'other'],
    ] as const) {
      const r = await w.call('submit', erfassen(), { cookie, project });
      expect(r.status).toBe(403);
      expect(await r.json()).toMatchObject({ error: { code: 'forbidden' } });
    }
    expect((await w.call('batch', { runs: [erfassen()] })).status).toBe(401);
    expect(count(w, 'runs')).toBe(0);
  });
});

describe('validation', () => {
  it('400 with the path of the problem', async () => {
    const w = await world();
    const cookie = w.cookies.anna;
    const bad = await w.call('submit', { ...erfassen(), task: 'Not A Key' }, { cookie });
    expect(bad.status).toBe(400);
    const body = (await bad.json()) as { error: { code: string; issues: { path: string }[] } };
    expect(body.error.code).toBe('invalid_body');
    expect(body.error.issues.map((i) => i.path)).toContain('task');

    const missing = erfassen();
    delete (missing as Partial<typeof missing>).input;
    const r2 = await w.call('submit', missing, { cookie });
    expect(((await r2.json()) as typeof body).error.issues.map((i) => i.path)).toContain('input');

    const batch = await w.call(
      'batch',
      { runs: [erfassen(), { ...erfassen(), configVersion: 'x' }] },
      { cookie },
    );
    expect(batch.status).toBe(400);
    expect(((await batch.json()) as typeof body).error.issues.map((i) => i.path)).toContain(
      'runs.1.configVersion',
    );

    const notJson = await w.call('submit', null, { cookie, raw: '{nope' });
    expect(notJson.status).toBe(400);
    expect(count(w, 'runs')).toBe(0);
  });

  it('the actor and causedBy cannot be sent: unknown fields are a 400', async () => {
    const w = await world();
    for (const extra of [{ actor: { id: 'root', kind: 'admin', roles: [] } }, { causedBy: uuid(7, 999) }]) {
      const r = await w.call('submit', { ...erfassen(), ...extra }, { cookie: w.cookies.anna });
      expect(r.status).toBe(400);
    }
    expect(count(w, 'runs')).toBe(0);
  });

  it('any JSON body is answered with the envelope and never a crash (property)', async () => {
    const w = await world();
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), fc.constantFrom('submit', 'batch'), async (value, which) => {
        const r = await w.call(which, value, { cookie: w.cookies.anna });
        expect(r.status).toBe(400);
        expect(((await r.json()) as { error: { code: string } }).error.code).toBe('invalid_body');
      }),
      { numRuns: 60 },
    );
  });
});

describe('the run envelope', () => {
  it('accepted: 200, the recorded actor is the session principal, and the ledger answers a repeat', async () => {
    const w = await world();
    const run = erfassen();
    const r = await w.call('submit', run, { cookie: w.cookies.anna });
    expect(r.status).toBe(200);
    const body = RunResponseSchema.parse(await r.json());
    expect(body).toMatchObject({ outcome: 'accepted', runId: run.id });
    if (body.outcome !== 'accepted') throw new Error('unreachable');
    expect(body.observations.length).toBeGreaterThan(0);
    expect(body.seq.to).toBeGreaterThanOrEqual(body.seq.from);
    expect(w.ctx.db.prepare('SELECT actor, actor_kind FROM runs WHERE id = ?').get(run.id)).toEqual({
      actor: 'anna',
      actor_kind: 'participant',
    });
    const observations = count(w, 'observations');
    const again = await w.call('submit', run, { cookie: w.cookies.anna });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(body);
    expect(count(w, 'observations')).toBe(observations);
  });

  it('an admin runs as the admin actor with their memberships as roles', async () => {
    const w = await world();
    const run = { id: uuid(7, 500), task: 'baumart_anlegen', configVersion: 1, input: { name_de: 'Linde' } };
    const r = await w.call('submit', run, { cookie: w.cookies.admin });
    expect(RunResponseSchema.parse(await r.json())).toMatchObject({ outcome: 'accepted' });
    expect(w.ctx.db.prepare('SELECT actor_kind FROM runs WHERE id = ?').get(run.id)).toEqual({
      actor_kind: 'admin',
    });
  });

  it('with both cookies in one browser the run is recorded as the participant, with the participant roles (WP-705)', async () => {
    const w = await world();
    const run = erfassen();
    const both = `${w.cookies.admin}; ${w.cookies.anna}`;
    expect((await w.call('submit', run, { cookie: both })).status).toBe(200);
    expect(w.ctx.db.prepare('SELECT actor, actor_kind FROM runs WHERE id = ?').get(run.id)).toEqual({
      actor: 'anna',
      actor_kind: 'participant',
    });
    const batched = erfassen();
    expect((await w.call('batch', { runs: [batched] }, { cookie: both })).status).toBe(200);
    expect(w.ctx.db.prepare('SELECT actor_kind FROM runs WHERE id = ?').get(batched.id)).toEqual({
      actor_kind: 'participant',
    });
  });

  it('a participant of another project does not mask the admin of this one', async () => {
    const w = await world();
    const run = erfassen();
    const both = `${w.cookies.admin}; ${w.cookies.annaOther}`;
    expect((await w.call('submit', run, { cookie: both })).status).toBe(200);
    expect(w.ctx.db.prepare('SELECT actor_kind FROM runs WHERE id = ?').get(run.id)).toEqual({
      actor_kind: 'admin',
    });
  });

  it('refused: 422 with the refusal, kept in the ledger; a repeat returns the stored refusal', async () => {
    const w = await world();
    const run = erfassen({ input: { vitalitaet: 'v1' } });
    const r = await w.call('submit', run, { cookie: w.cookies.anna });
    expect(r.status).toBe(422);
    const body = RunResponseSchema.parse(await r.json());
    expect(body).toMatchObject({ outcome: 'refused', runId: run.id, refusal: { code: 'geometry_required' } });
    expect(count(w, 'observations')).toBe(0);
    expect(w.ctx.db.prepare('SELECT outcome FROM runs WHERE id = ?').get(run.id)).toEqual({
      outcome: 'rejected',
    });
    const again = await w.call('submit', run, { cookie: w.cookies.anna });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual(body);
  });

  it('a config version the server no longer holds answers review (409), and writes nothing', async () => {
    const w = await world();
    const run = erfassen({ configVersion: 9 });
    const r = await w.call('submit', run, { cookie: w.cookies.anna });
    expect(r.status).toBe(409);
    expect(RunResponseSchema.parse(await r.json())).toEqual({
      v: SYNC_PROTOCOL_VERSION,
      outcome: 'review',
      runId: run.id,
      reason: 'config_version_gone',
      configVersion: 9,
    });
    expect(count(w, 'runs')).toBe(0);
    const b = await w.call('batch', { runs: [erfassen({ configVersion: 9 })] }, { cookie: w.cookies.anna });
    expect(b.status).toBe(409);
    expect(BatchResponseSchema.parse(await b.json())).toMatchObject({ outcome: 'review', configVersion: 9 });
  });
});

describe('batches (H2)', () => {
  it('accepted: one result per run and one contiguous seq range', async () => {
    const w = await world();
    const runs = [erfassen(), erfassen(), erfassen()];
    const r = await w.call('batch', { runs }, { cookie: w.cookies.anna });
    expect(r.status).toBe(200);
    const body = BatchResponseSchema.parse(await r.json());
    if (body.outcome !== 'accepted') throw new Error('expected accepted');
    expect(body.results.map((x) => x.runId)).toEqual(runs.map((x) => x.id));
    expect(body.seq.to - body.seq.from + 1).toBe(count(w, 'observations'));
    const again = await w.call('batch', { runs }, { cookie: w.cookies.anna });
    expect(await again.json()).toEqual(body);
  });

  it('is atomic: one refused run refuses the batch and leaves no state', async () => {
    const w = await world();
    const runs = [erfassen(), erfassen(), erfassen({ input: { vitalitaet: 'v1' } }), erfassen()];
    const r = await w.call('batch', { runs }, { cookie: w.cookies.anna });
    expect(r.status).toBe(422);
    expect(BatchResponseSchema.parse(await r.json())).toMatchObject({
      outcome: 'refused',
      index: 2,
      runId: runs[2]?.id,
      refusal: { code: 'geometry_required' },
    });
    for (const table of ['observations', 'features', 'edges', 'tombstones']) expect(count(w, table)).toBe(0);
    const retry = await w.call('batch', { runs }, { cookie: w.cookies.anna });
    expect(retry.status).toBe(422);
  });
});

describe('limits', () => {
  it('a body over the limit is a 413, also without a content-length (streamed)', async () => {
    const w = await world({ maxBodyBytes: 200 });
    const cookie = w.cookies.anna;
    const declared = await w.call('submit', erfassen({ input: { note: 'x'.repeat(500) } }), { cookie });
    expect(declared.status).toBe(413);
    expect(await declared.json()).toMatchObject({ error: { code: 'payload_too_large' } });
    const text = JSON.stringify(erfassen({ input: { note: 'x'.repeat(500) } }));
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(text.slice(0, 100)));
        c.enqueue(new TextEncoder().encode(text.slice(100)));
        c.close();
      },
    });
    const streamed = await w.call('submit', null, { cookie, raw: stream });
    expect(streamed.status).toBe(413);
    expect(count(w, 'runs')).toBe(0);
  });

  it('the default batch size is 500; one more is a 413, and the limit is configurable', async () => {
    expect(DEFAULT_HTTP_LIMITS.maxBatchRuns).toBe(500);
    const w = await world();
    const runs = Array.from({ length: 501 }, () => erfassen());
    const r = await w.call('batch', { runs }, { cookie: w.cookies.anna });
    expect(r.status).toBe(413);
    expect(await r.json()).toMatchObject({ error: { code: 'batch_too_large' } });
    expect(count(w, 'runs')).toBe(0);

    const small = await world({ maxBatchRuns: 2 });
    const three = await small.call(
      'batch',
      { runs: [erfassen(), erfassen(), erfassen()] },
      { cookie: small.cookies.anna },
    );
    expect(three.status).toBe(413);
    const two = await small.call('batch', { runs: [erfassen(), erfassen()] }, { cookie: small.cookies.anna });
    expect(two.status).toBe(200);
  });
});

describe('protocol version (WP-144)', () => {
  it('every reply of both handlers carries v = SYNC_PROTOCOL_VERSION: accepted, refused, review, 400, 401, 403, 413', async () => {
    const w = await world({ maxBatchRuns: 1 });
    const cookie = w.cookies.anna;
    const replies: Response[] = [
      await w.call('submit', erfassen(), { cookie }),
      await w.call('submit', erfassen({ input: { vitalitaet: 'v1' } }), { cookie }),
      await w.call('submit', erfassen({ configVersion: 9 }), { cookie }),
      await w.call('submit', { nope: 1 }, { cookie }),
      await w.call('submit', erfassen()),
      await w.call('submit', erfassen(), { cookie, project: 'other' }),
      await w.call('batch', { runs: [erfassen()] }, { cookie }),
      await w.call('batch', { runs: [erfassen({ input: { vitalitaet: 'v1' } })] }, { cookie }),
      await w.call('batch', { runs: [erfassen({ configVersion: 9 })] }, { cookie }),
      await w.call('batch', { runs: [erfassen(), erfassen()] }, { cookie }),
      await w.call('batch', { runs: 3 }, { cookie }),
    ];
    expect(new Set(replies.map((r) => r.status))).toEqual(new Set([200, 422, 409, 400, 401, 403, 413]));
    for (const r of replies) expect(((await r.json()) as { v?: unknown }).v).toBe(SYNC_PROTOCOL_VERSION);
  });

  it('the response schemas require v', () => {
    const review = { outcome: 'review', runId: 'x', reason: 'config_version_gone', configVersion: 1 };
    expect(RunResponseSchema.safeParse(review).success).toBe(false);
    expect(RunResponseSchema.safeParse({ v: SYNC_PROTOCOL_VERSION, ...review }).success).toBe(true);
  });
});

describe('the session participant (WP-768)', () => {
  it('every reply names the session participant', async () => {
    const w = await world();
    const cookie = w.cookies.anna;
    const one = await w.call('submit', erfassen(), { cookie, as: 'anna' });
    expect(one.status).toBe(200);
    expect(one.headers.get(SESSION_PARTICIPANT_HEADER)).toBe('anna');
    const batch = await w.call('batch', { runs: [erfassen()] }, { cookie });
    expect(batch.headers.get(SESSION_PARTICIPANT_HEADER)).toBe('anna');
  });

  it('a request made as another participant is a 409 session_changed: nothing is stored, the reply names the session', async () => {
    const w = await world();
    const cookie = w.cookies.anna; // the cookie belongs to anna; the device works as olga
    for (const which of ['submit', 'batch'] as const) {
      const body = which === 'submit' ? erfassen() : { runs: [erfassen()] };
      const r = await w.call(which, body, { cookie, as: 'olga' });
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ code: 'session_changed', v: SYNC_PROTOCOL_VERSION });
      expect(r.headers.get(SESSION_PARTICIPANT_HEADER)).toBe('anna');
    }
    expect(count(w, 'runs')).toBe(0);
  });
});
