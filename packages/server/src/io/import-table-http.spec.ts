// WP-433: a Tabelle imported over the same endpoints as an Objektart: dry run, job, replace.
import { describe, expect, it } from 'vitest';
import { CREATE_TASK } from '@ueberblick/core';
import type { Principal } from '../auth/contract';
import { createAdminImportHandlers, createImportService } from '../http/admin-import';
import { setup } from '../store/run/testkit';

const ADMIN = { kind: 'admin', id: 'a1' } as unknown as Principal;
const MAPPING = { task: CREATE_TASK, type: 'baumart', fields: { name_de: 'Name', name_lat: 'Latein' } };
const csv = (rows: readonly string[]): string => ['Name;Latein', ...rows].join('\n');

function world() {
  const ctx = setup();
  const service = createImportService({
    db: () => ctx.db,
    store: () => ctx.store,
    clock: ctx.deps.clock,
    ids: ctx.deps.ids,
    geo: ctx.deps.geo,
  });
  const handlers = createAdminImportHandlers({
    authorizeAdmin: (_p, key) => ({ projectKey: key }),
    deployed: () => ({ version: 1, config: ctx.config }),
    service,
  });
  const call = (path: string, form?: FormData) => ({
    request: new Request(`http://x/api/admin/p/demo/${path}`, { method: 'POST', body: form ?? null }),
    params: { project: 'demo' },
    principal: ADMIN,
  });
  const body = (text: string, extra: Record<string, string> = {}): FormData => {
    const form = new FormData();
    form.set('file', new File([text], 'arten.csv'));
    form.set('mapping', JSON.stringify(MAPPING));
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  };
  const rows = (): { name: string; lifecycle: string }[] =>
    ctx.db
      .prepare<{ properties: string; lifecycle: string }>(
        "SELECT properties, lifecycle FROM features WHERE type = 'baumart' ORDER BY rowid",
      )
      .all()
      .map((r) => ({
        name: (JSON.parse(r.properties) as { name_de: string }).name_de,
        lifecycle: r.lifecycle,
      }));
  const run = async (text: string, extra: Record<string, string> = {}) => {
    const res = await handlers.start(call('import', body(text, extra)));
    expect(res.status).toBe(202);
    await service.idle();
    return ((await res.json()) as { job: string }).job;
  };
  return { handlers, call, body, rows, run };
}

describe('a Tabelle over the import endpoints', () => {
  it('the dry run counts the rows and previews their values', async () => {
    const w = world();
    const res = await w.handlers.plan(w.call('import/plan', w.body(csv(['Eiche;Quercus', 'Buche;Fagus']))));
    const out = (await res.json()) as { counts: { valid: number }; preview: { values: unknown }[] };
    expect(out.counts.valid).toBe(2);
    expect(out.preview[0]?.values).toMatchObject({ name_de: 'Eiche', name_lat: 'Quercus' });
    expect(w.rows()).toEqual([]);
  });

  it('imports the rows, and replace retires the old rows through runs', async () => {
    const w = world();
    await w.run(csv(['Eiche;Quercus', 'Buche;Fagus']));
    expect(w.rows().map((r) => r.name)).toEqual(['Eiche', 'Buche']);
    await w.run(csv(['Linde;Tilia']), { replace: 'true' });
    expect(w.rows()).toEqual([
      { name: 'Eiche', lifecycle: 'deleted' },
      { name: 'Buche', lifecycle: 'deleted' },
      { name: 'Linde', lifecycle: 'active' },
    ]);
  });
});
