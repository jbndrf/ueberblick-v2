// WP-363: import over HTTP: dry run, job with progress, constants, replace, refusals, restart.
import { describe, expect, it } from 'vitest';
import type { Principal } from '../../auth/contract';
import { count, features, TREE_MAPPING } from '../../io/testkit';
import { setup } from '../../store/run/testkit';
import { createAdminImportHandlers, createImportService, type AdminImportHandlers } from './index';

const ADMIN = { kind: 'admin', id: 'a1' } as unknown as Principal;
const PARTICIPANT = { kind: 'participant', id: 'p1' } as unknown as Principal;

const csv = (rows: readonly string[]): string => ['vit;x;y;z', ...rows].join('\n');
const GOOD = ['v1;500000;5538630;100', 'v2;500010;5538640;101', 'v3;500020;5538650;102'];
const mapping = { ...TREE_MAPPING, sourceCrs: 'EPSG:25832' };

function world(opts: { deployed?: boolean; maxFileBytes?: number } = {}) {
  const ctx = setup();
  const service = createImportService({
    db: () => ctx.db,
    store: () => ctx.store,
    clock: ctx.deps.clock,
    ids: ctx.deps.ids,
    geo: ctx.deps.geo,
  });
  const handlers: AdminImportHandlers = createAdminImportHandlers({
    authorizeAdmin: (p, key) =>
      p === null
        ? new Response('no', { status: 401 })
        : p.kind !== 'admin'
          ? new Response('no', { status: 403 })
          : { projectKey: key },
    deployed: () => (opts.deployed === false ? undefined : { version: 1, config: ctx.config }),
    service,
    ...(opts.maxFileBytes === undefined ? {} : { maxFileBytes: opts.maxFileBytes }),
  });
  const body = (text: string, fields: Record<string, unknown>, name = 'bäume.csv'): FormData => {
    const form = new FormData();
    form.set('file', new File([text], name));
    form.set('mapping', JSON.stringify(fields['mapping'] ?? mapping));
    for (const [k, v] of Object.entries(fields)) if (k !== 'mapping') form.set(k, String(v));
    return form;
  };
  const call = (path: string, init: RequestInit = {}, principal: Principal | null = ADMIN, params = {}) => ({
    request: new Request(`http://x/api/admin/p/demo/${path}`, init),
    params: { project: 'demo', ...params },
    principal,
  });
  const post = (path: string, form: FormData, principal: Principal | null = ADMIN) =>
    call(path, { method: 'POST', body: form }, principal);
  /** Starts an import, waits for the job and returns its final state. */
  const run = async (text: string, fields: Record<string, unknown> = {}) => {
    const res = await handlers.start(post('import', body(text, fields)));
    expect(res.status).toBe(202);
    const { job } = (await res.json()) as { job: string };
    await service.idle();
    const status = handlers.status(call(`import/${job}`, {}, ADMIN, { job }));
    return ((await status.json()) as { job: Record<string, unknown> }).job;
  };
  return { ctx, handlers, service, body, post, call, run };
}

describe('import over HTTP', () => {
  it('the dry run returns counts, problems and a preview, and writes nothing', async () => {
    const w = world();
    const before = count(w.ctx, 'runs');
    const res = await w.handlers.plan(
      w.post('import/plan', w.body(csv([...GOOD, 'v1;abc;5538630;100']), { constants: '' })),
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      counts: Record<string, number>;
      problems: { row: number }[];
      preview: { row: number; values: Record<string, unknown> }[];
    };
    expect(out.counts).toMatchObject({ valid: 3, problem_rows: 1 });
    expect(out.problems.map((p) => p.row)).toEqual([4]);
    expect(out.preview).toHaveLength(3);
    expect(out.preview[0]?.values).toMatchObject({ vitalitaet: 'v1' });
    expect(count(w.ctx, 'runs')).toBe(before);
    expect(count(w.ctx, 'features')).toBe(0);
  });

  it('atomic: all rows, the job ends done with progress at the total', async () => {
    const w = world();
    const job = await w.run(csv(GOOD), { mode: 'atomic' });
    expect(job).toMatchObject({
      state: 'done',
      outcome: 'accepted',
      imported: 3,
      rows_done: 3,
      rows_total: 3,
    });
    expect(features(w.ctx)).toHaveLength(3);
  });

  it('atomic: one bad row refuses the whole file', async () => {
    const w = world();
    const job = await w.run(csv([...GOOD, 'v1;abc;5538630;100']), { mode: 'atomic' });
    expect(job).toMatchObject({ state: 'done', outcome: 'refused', imported: 0, problem_count: 1 });
    expect(features(w.ctx)).toHaveLength(0);
  });

  it('skip: the good rows are imported and the bad ones reported', async () => {
    const w = world();
    const job = await w.run(csv([...GOOD, 'v1;abc;5538630;100']), { mode: 'skip' });
    expect(job).toMatchObject({ state: 'done', outcome: 'accepted', imported: 3, problem_count: 1 });
    expect(features(w.ctx)).toHaveLength(3);
  });

  it('constants set the stage of every row; an unfitting one is reported, never bypassed', async () => {
    const w = world();
    const ok = await w.run(csv(GOOD), { mapping: { ...mapping, constants: { stage: 'massnahme' } } });
    expect(ok).toMatchObject({ state: 'done', outcome: 'accepted', imported: 3 });
    expect(features(w.ctx).map((f) => f.properties['stage'])).toEqual([
      'massnahme',
      'massnahme',
      'massnahme',
    ]);
    const bad = await w.run(csv(GOOD), { mapping: { ...mapping, constants: { stage: 'nope' } } });
    expect(bad).toMatchObject({ state: 'done', outcome: 'refused', imported: 0 });
    expect(JSON.stringify(bad['problems'])).toContain('invalid_input');
    expect(features(w.ctx)).toHaveLength(3);
  });

  it('replace retires the old features through runs and imports the new ones', async () => {
    const w = world();
    await w.run(csv(GOOD), {});
    const job = await w.run(csv(GOOD.slice(0, 2)), { replace: true });
    expect(job).toMatchObject({ state: 'done', outcome: 'accepted', imported: 2, replace: true });
    const states = w.ctx.db
      .prepare<{ lifecycle: string; n: number }>(
        'SELECT lifecycle, count(*) AS n FROM features GROUP BY lifecycle',
      )
      .all();
    expect(Object.fromEntries(states.map((s) => [s.lifecycle, s.n]))).toEqual({ deleted: 3, active: 2 });
  });

  it('replace: a refusal anywhere leaves the old data untouched', async () => {
    const w = world();
    await w.run(csv(GOOD), {});
    const job = await w.run(csv(GOOD), {
      replace: true,
      mapping: { ...mapping, constants: { stage: 'nope' } },
    });
    expect(job).toMatchObject({ outcome: 'refused', imported: 0 });
    expect(count(w.ctx, 'features')).toBe(3);
    expect(features(w.ctx)).toHaveLength(3);
    const live = w.ctx.db
      .prepare<{ n: number }>("SELECT count(*) AS n FROM features WHERE lifecycle = 'active'")
      .get();
    expect(live?.n).toBe(3);
  });

  it('refuses a never published project, replace without atomic, and an oversized file', async () => {
    const draft = world({ deployed: false });
    const none = await draft.handlers.start(draft.post('import', draft.body(csv(GOOD), {})));
    expect(none.status).toBe(409);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe('not_published');

    const w = world();
    const skip = await w.handlers.start(w.post('import', w.body(csv(GOOD), { mode: 'skip', replace: true })));
    expect(skip.status).toBe(422);
    expect(((await skip.json()) as { error: { code: string } }).error.code).toBe('replace_needs_atomic');

    const small = world({ maxFileBytes: 10 });
    const big = await small.handlers.start(small.post('import', small.body(csv(GOOD), {})));
    expect(big.status).toBe(413);
    expect(((await big.json()) as { error: { code: string } }).error.code).toBe('file_too_large');
    expect(count(small.ctx, 'features')).toBe(0);
  });

  it('refuses 401 and 403 and a malformed upload', async () => {
    const w = world();
    expect((await w.handlers.plan(w.post('import/plan', w.body(csv(GOOD), {}), null))).status).toBe(401);
    expect((await w.handlers.start(w.post('import', w.body(csv(GOOD), {}), PARTICIPANT))).status).toBe(403);
    expect(w.handlers.status(w.call('import/x', {}, null, { job: 'x' })).status).toBe(401);
    const form = new FormData();
    form.set('file', new File(['a'], 'a.csv'));
    expect((await w.handlers.plan(w.post('import/plan', form))).status).toBe(400);
    expect(w.handlers.status(w.call('import/nope', {}, ADMIN, { job: 'nope' })).status).toBe(404);
  });

  it('a job a restart left running reads as failed', async () => {
    const w = world();
    w.ctx.db
      .prepare(
        "INSERT INTO import_jobs (id, state, mode, replace, task, created_at, updated_at) VALUES ('j1', 'running', 'atomic', 0, 'erfassen', 't', 't')",
      )
      .run();
    const res = w.handlers.status(w.call('import/j1', {}, ADMIN, { job: 'j1' }));
    const { job } = (await res.json()) as { job: { state: string; error: string } };
    expect(job.state).toBe('failed');
    expect(job.error).toContain('restarted');
  });
});
