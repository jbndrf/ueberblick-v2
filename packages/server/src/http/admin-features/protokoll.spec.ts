// WP-372 (owner A3): GET features/<id>/runs/<run>, the Protokoll of one past run. One test or more per acceptance item.
import { compilePerms, type CompiledConfig, type Json } from '@ueberblick/core';
import { describe, expect, it } from 'vitest';
import type { Principal } from '../../auth/contract';
import { createVersionCache } from '../../store/run/config-for';
import { IDS, actor, anna, bernd, golden, seedMusterstadt, setup, vera } from '../../store/run/testkit';
import { createProtokollHandler, protokollOf, visibleProperties, type Protokoll } from './index';

const ADMIN = { kind: 'admin', id: 'a1', projectId: null, roles: [] } as unknown as Principal;
const root = actor('admin', 'root', ['kontrolle']);

/** A task form with the role-restricted property `intern_notiz` (`see` lists kontrolle and verwaltung only). */
const withNotiz = (c: CompiledConfig, label = 'Befund'): CompiledConfig => {
  const tasks = c.file.tasks as NonNullable<CompiledConfig['file']['tasks']>;
  const task = tasks['kontrolle'] as NonNullable<(typeof tasks)[string]>;
  const form = { ...task.form, befund: { ...task.form?.['befund'], label }, intern_notiz: {} };
  return { ...c, file: { ...c.file, tasks: { ...tasks, kontrolle: { ...task, form } } } } as CompiledConfig;
};

function world(configs: Record<number, CompiledConfig> = { 1: withNotiz(golden('musterstadt-plain')) }) {
  const latest = Math.max(...Object.keys(configs).map(Number));
  const ctx = setup({
    config: configs[latest] as CompiledConfig,
    version: latest,
    configs: new Map(Object.entries(configs).map(([k, v]) => [Number(k), v])),
    deployed: latest,
  });
  seedMusterstadt(ctx);
  const versions = createVersionCache((v) => configs[v]);
  const handler = createProtokollHandler({
    authorizeAdmin: (p, key) => (p === null ? new Response('no', { status: 401 }) : { projectKey: key }),
    db: () => ctx.db,
    versions: () => versions,
  });
  const get = (feature: string, run: string, principal: Principal | null = ADMIN) =>
    handler({
      request: new Request(`http://x/api/admin/p/demo/features/${feature}/runs/${run}`),
      params: { project: 'demo', feature, run },
      principal,
    });
  const protokoll = async (feature: string, run: string): Promise<Protokoll> =>
    (await get(feature, run).json()) as Protokoll;
  return { ctx, versions, get, protokoll };
}

const input: Record<string, Json> = { vitalitaet: 'v2', befund: 'Kronenpflege', intern_notiz: 'nur intern' };

describe('Protokoll of one run', () => {
  it('returns the run, its form and the values the run wrote', async () => {
    const w = world();
    const run = w.ctx.run('kontrolle', root, input, IDS.t_in);
    expect(w.ctx.store.submit(run).outcome).toBe('accepted');
    const p = await w.protokoll(IDS.t_in, run.id);
    expect(p.run).toMatchObject({ id: run.id, task: 'kontrolle', configVersion: 1 });
    expect(p.run.actor).toMatchObject({ id: 'root', kind: 'admin' });
    expect(p.run.taskLabel).toEqual({ de: 'Kontrolle durchführen', en: 'Perform inspection' });
    expect(p.type).toBe('baum');
    expect(Object.keys(p.form)).toContain('befund');
    expect(p.properties['befund']).toMatchObject({ type: 'text' });
    expect(p.values).toMatchObject({ vitalitaet: 'v2', befund: 'Kronenpflege' });
    // rule runs the task caused (stage, faellig_am ...) are not form fields and not in the values
    expect(Object.keys(p.values).every((k) => k in p.form)).toBe(true);
  });

  it('an admin sees every field, including a role-restricted one', async () => {
    const w = world();
    const run = w.ctx.run('kontrolle', root, input, IDS.t_in);
    w.ctx.store.submit(run);
    const p = await w.protokoll(IDS.t_in, run.id);
    expect(p.values['intern_notiz']).toBe('nur intern');
    expect(p.properties['intern_notiz']).toBeDefined();
  });

  it('a run made under an older config version shows that version’s form', async () => {
    const v1 = withNotiz(golden('musterstadt-plain'), 'Befund (alt)');
    const v2 = withNotiz(golden('musterstadt-plain'), 'Befund (neu)');
    const w = world({ 1: v1, 2: v2 });
    const old = w.ctx.run('kontrolle', root, input, IDS.t_in);
    w.ctx.store.submit(old);
    w.ctx.db.prepare('UPDATE runs SET config_version = 1 WHERE id = ?').run(old.id);
    const fresh = w.ctx.run('kontrolle', root, { ...input, befund: 'neu' }, IDS.t_in);
    w.ctx.store.submit(fresh);
    expect((await w.protokoll(IDS.t_in, old.id)).form['befund']).toMatchObject({ label: 'Befund (alt)' });
    expect((await w.protokoll(IDS.t_in, old.id)).run.configVersion).toBe(1);
    expect((await w.protokoll(IDS.t_in, fresh.id)).form['befund']).toMatchObject({ label: 'Befund (neu)' });
  });

  it('unknown feature, a run of another feature, an unknown run and a refused run are 404', async () => {
    const w = world();
    const run = w.ctx.run('kontrolle', root, input, IDS.t_in);
    w.ctx.store.submit(run);
    const refused = w.ctx.run('kontrolle', anna, { vitalitaet: 'v2', befund: 'Kronenpflege' }, IDS.t_in);
    expect(w.ctx.store.submit(refused).outcome).toBe('refused');
    expect(w.get('nope', run.id).status).toBe(404);
    expect(w.get(IDS.t_out, run.id).status).toBe(404);
    expect(w.get(IDS.t_in, 'nope').status).toBe(404);
    const res = w.get(IDS.t_in, refused.id);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('refused');
  });

  it('is admin only: 401 without a session', () => {
    const w = world();
    expect(w.get(IDS.t_in, 'x', null).status).toBe(401);
  });

  it('a version that is no longer stored is 404, never a guess', () => {
    const w = world();
    const run = w.ctx.run('kontrolle', root, input, IDS.t_in);
    w.ctx.store.submit(run);
    w.ctx.db.prepare('UPDATE runs SET config_version = 9 WHERE id = ?').run(run.id);
    expect(w.get(IDS.t_in, run.id).status).toBe(404);
  });
});

describe('Protokoll: names of referenced features (WP-1076)', () => {
  /** The baum type gets a `pate` reference to another baum, asked in the task form. */
  const withPate = (c: CompiledConfig): CompiledConfig => {
    const base = withNotiz(c);
    const types = base.file.types as NonNullable<CompiledConfig['file']['types']>;
    const tasks = base.file.tasks as NonNullable<CompiledConfig['file']['tasks']>;
    const task = tasks['kontrolle'] as NonNullable<(typeof tasks)[string]>;
    const baum = types['baum'] as NonNullable<(typeof types)[string]>;
    return {
      ...base,
      file: {
        ...base.file,
        types: {
          ...types,
          baum: { ...baum, properties: { ...baum.properties, pate: { type: 'reference', to: 'baum' } } },
        },
        tasks: { ...tasks, kontrolle: { ...task, form: { ...task.form, pate: {} } } },
      },
    } as CompiledConfig;
  };

  it('returns the name of the referenced feature; a deleted one too; an id with no row is absent', async () => {
    const w = world({ 1: withPate(golden('musterstadt-plain')) });
    const run = w.ctx.run('kontrolle', root, { ...input, pate: IDS.t_out }, IDS.t_in);
    expect(w.ctx.store.submit(run).outcome).toBe('accepted');
    const p = await w.protokoll(IDS.t_in, run.id);
    expect(p.values['pate']).toBe(IDS.t_out);
    const label = p.labels[IDS.t_out];
    expect(typeof label).toBe('string');
    expect(label).not.toBe(IDS.t_out);
    w.ctx.db.prepare("UPDATE features SET lifecycle = 'deleted' WHERE id = ?").run(IDS.t_out);
    expect((await w.protokoll(IDS.t_in, run.id)).labels).toEqual({ [IDS.t_out]: label });
    w.ctx.db.prepare('DELETE FROM features WHERE id = ?').run(IDS.t_out);
    expect((await w.protokoll(IDS.t_in, run.id)).labels).toEqual({});
  });
});

describe('Protokoll: who may read which field', () => {
  const config = withNotiz(golden('musterstadt-plain'));
  const perms = compilePerms(config);
  const keys = ['befund', 'intern_notiz', 'vitalitaet'];

  it('a participant is bound by Perms.readable (the sync’s call), an admin is not', () => {
    expect([...visibleProperties(perms, 'baum', bernd, keys)].sort()).toEqual(['befund', 'vitalitaet']);
    expect([...visibleProperties(perms, 'baum', anna, keys)].sort()).toEqual(keys);
    expect([...visibleProperties(perms, 'baum', vera, keys)].sort()).toEqual(keys);
    expect([...visibleProperties(perms, 'baum', actor('admin', 'root'), keys)].sort()).toEqual(keys);
    expect(visibleProperties(perms, 'unbekannt', bernd, keys).size).toBe(0);
  });

  it('fields the viewer may not read are absent from form, properties and values', () => {
    const w = world();
    const run = w.ctx.run('kontrolle', root, input, IDS.t_in);
    w.ctx.store.submit(run);
    const asBauhof = protokollOf(w.ctx.db, w.versions, IDS.t_in, run.id, bernd) as Protokoll;
    expect(asBauhof.form['intern_notiz']).toBeUndefined();
    expect(asBauhof.properties['intern_notiz']).toBeUndefined();
    expect('intern_notiz' in asBauhof.values).toBe(false);
    expect(JSON.stringify(asBauhof)).not.toContain('nur intern');
    expect(asBauhof.values['befund']).toBe('Kronenpflege');
    const asKontrolle = protokollOf(w.ctx.db, w.versions, IDS.t_in, run.id, anna) as Protokoll;
    expect(asKontrolle.values['intern_notiz']).toBe('nur intern');
  });
});

describe('Protokoll of a task without a form', () => {
  /** `baum_bearbeiten` is a quick edit plus a location step: it has no `form`. */
  const noForm = (w: ReturnType<typeof world>, who = root, inp: Record<string, Json> = {}) => {
    const run = w.ctx.run('baum_bearbeiten', who, inp, IDS.t_in);
    const out = w.ctx.store.submit(run);
    expect(JSON.stringify(out)).toContain('accepted');
    return run;
  };
  const guard = (c: CompiledConfig): CompiledConfig => {
    const tasks = c.file.tasks as NonNullable<CompiledConfig['file']['tasks']>;
    const t = tasks['baum_bearbeiten'] as NonNullable<(typeof tasks)[string]>;
    return {
      ...c,
      file: {
        ...c.file,
        tasks: {
          ...tasks,
          baum_bearbeiten: {
            ...t,
            who: ['admin'],
            steps: [
              { kind: 'quick_edit', properties: ['beschreibung', 'intern_notiz'] },
              ...(t.steps ?? []).slice(1),
            ],
          },
        },
      },
    } as CompiledConfig;
  };

  it('shows the properties the run wrote as one page', async () => {
    const w = world({ 1: guard(withNotiz(golden('musterstadt-plain'))) });
    const run = noForm(w, root, { beschreibung: { de: 'Neue Beschreibung' } });
    const p = await w.protokoll(IDS.t_in, run.id);
    expect(p.form['beschreibung']).toBeDefined();
    expect(p.properties['beschreibung']).toBeDefined();
    expect(p.values['beschreibung']).toEqual({ de: 'Neue Beschreibung' });
  });

  it('a role-restricted written property is absent for a participant viewer', () => {
    const w = world({ 1: guard(withNotiz(golden('musterstadt-plain'))) });
    const run = noForm(w, root, { beschreibung: { de: 'x' }, intern_notiz: 'nur intern' });
    const admin = protokollOf(w.ctx.db, w.versions, IDS.t_in, run.id, root) as Protokoll;
    expect(admin.values['intern_notiz']).toBe('nur intern');
    const bauhof = protokollOf(w.ctx.db, w.versions, IDS.t_in, run.id, bernd) as Protokoll;
    expect(bauhof.form['intern_notiz']).toBeUndefined();
    expect(JSON.stringify(bauhof)).not.toContain('nur intern');
    expect(bauhof.values['beschreibung']).toEqual({ de: 'x' });
  });

  it('a run that wrote nothing stays empty', async () => {
    const w = world({ 1: guard(withNotiz(golden('musterstadt-plain'))) });
    const run = noForm(w, root, {});
    const p = await w.protokoll(IDS.t_in, run.id);
    expect(p.form).toEqual({});
    expect(p.values).toEqual({});
  });
});
