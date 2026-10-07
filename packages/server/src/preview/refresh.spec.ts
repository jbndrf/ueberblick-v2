// WP-341: every accepted draft save deploys the draft into the preview (debounced, last good on errors, value moves).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { FeatureId, Json, Key, RunId, TemplateFile } from '@ueberblick/core';
import { createProject } from '../admin/bootstrap';
import { createAuth } from '../auth';
import { createDraftStore, seedDraft } from '../builder-draft';
import { deployedVersion, deployProject, loadConfig, versions } from '../deploy';
import { createMoveExecutor } from '../deploy/move-executor';
import type { Db } from '../db/driver';
import { openControlDb, openProjectDb, openProjectDbFile } from '../db/open';
import { composeProjectStore } from '../http/shared/stores';
import { logSpy } from '../store/run/log.testkit';
import { createPreviewRefresher } from './refresh';
import { ensurePreview, previewDbPath, previewOf } from './registry';

const clock = { now: () => '2026-10-01T10:00:00Z' };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TEMPLATE = {
  schema: 'ueberblick/1',
  template: { key: 'moves', version: '1.0.0' },
  roles: { maker: { label: 'Maker' } },
  types: {
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        stage: {
          type: 'select',
          options: { erfasst: 'Erfasst', kontrolliert: 'Kontrolliert', geprueft: 'Geprüft' },
        },
        notiz: { type: 'text' },
      },
    },
  },
  tasks: {
    anlegen: {
      label: 'Anlegen',
      who: ['admin'],
      on: '$map',
      creates: 'baum',
      form: { stage: {}, notiz: {} },
    },
  },
} as unknown as TemplateFile;

const overlay = (extra: Record<string, unknown> = {}): string =>
  stringify({ schema: 'ueberblick/1', extends: 'moves@1', ...extra });
const HIDE_OPTION = 'types.baum.properties.stage.options.kontrolliert';

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-refresh-'));
  dirs.push(dir);
  const control = openControlDb(':memory:');
  const project = createProject(control, { key: 'demo', name: 'Demo' }, clock);
  const real = openProjectDb(':memory:', 'demo');
  seedDraft(real, {
    template: 'moves',
    templateVersion: '1.0.0',
    overlay: overlay(),
    by: 'admin',
    at: clock.now(),
  });
  const opened = new Map<string, Db>();
  const previewDb = (): Db => {
    let db = opened.get('p');
    if (!db) opened.set('p', (db = openProjectDbFile(previewDbPath(dir, 'demo'))));
    return db;
  };
  const timers: Array<() => void> = [];
  const after = { n: 0 };
  const refresher = createPreviewRefresher({
    control,
    clock,
    auth: createAuth({ control, now: () => new Date(clock.now()), participantRoles: () => [] }),
    templates: { resolve: (ref) => (ref.startsWith('moves@') ? TEMPLATE : undefined) },
    project: (key) => (key === 'demo' ? project : undefined),
    draftDb: () => real,
    ensurePreview: (id) => ensurePreview(control, dir, id, clock),
    previewDb,
    afterDeploy: () => {
      after.n++;
    },
    schedule: (fn) => {
      timers.push(fn);
      return () => {
        const i = timers.indexOf(fn);
        if (i >= 0) timers.splice(i, 1);
      };
    },
  });
  const save = (text: string): void => {
    const d = createDraftStore(real).get();
    createDraftStore(real).putIf(d?.revision ?? 1, text, 'admin', clock.now());
  };
  const fire = (): void => timers.splice(0).forEach((f) => f());
  return { dir, control, project, real, previewDb, refresher, save, fire, timers, after };
}

const counts = (db: Db): string =>
  JSON.stringify(
    ['observations', 'runs', 'features', 'config_versions', 'participants']
      .map((t) => db.prepare<{ n: number }>(`SELECT count(*) n FROM ${t}`).get()?.n)
      .concat(db.prepare<{ m: number | null }>('SELECT max(seq) m FROM observations').get()?.m ?? 0),
  );

describe('schedulePreviewRefresh', () => {
  it('a draft save deploys the draft into the preview after the debounce; two saves give one deploy', () => {
    const w = world();
    w.save(overlay({ hide: [HIDE_OPTION] }));
    w.refresher.schedulePreviewRefresh('demo');
    w.save(overlay({ hide: [HIDE_OPTION] }) + '\n# edited');
    w.refresher.schedulePreviewRefresh('demo');
    expect(w.timers).toHaveLength(1); // coalesced
    expect(
      w.previewDb().prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get('config_versions'),
    ).toBeDefined();
    expect(versions(w.previewDb())).toEqual([]); // nothing before the debounce fires
    w.fire();
    const db = w.previewDb();
    expect(versions(db)).toHaveLength(1);
    const file = loadConfig(db, deployedVersion(db)?.version ?? 0)?.file;
    expect(
      Object.keys((file?.types?.['baum']?.properties?.['stage'] as { options: object }).options),
    ).toEqual(['erfasst', 'geprueft']);
    expect(w.after.n).toBe(1);
    expect(w.refresher.previewState('demo')).toMatchObject({ status: 'ready', problems: 0, version: 1 });
  });

  it('a save while no draft exists schedules nothing harmful: the refresh reports the state unchanged', () => {
    const w = world();
    createDraftStore(w.real); // no-op
    w.real.prepare('DELETE FROM builder_draft').run();
    expect(w.refresher.refreshPreview('demo')).toMatchObject({ status: 'dropped', version: null });
  });

  it('WP-505: a never-published project with a draft gets its preview and logins on the first ask', () => {
    const w = world();
    expect(deployedVersion(w.real)).toBeUndefined();
    expect(previewOf(w.control, w.project.id)).toBeUndefined();
    expect(w.refresher.previewState('demo')).toMatchObject({ status: 'ready', problems: 0 });
    expect(w.refresher.previewLogins('demo').map((l) => l.role)).toEqual(['maker', null]);
    expect(deployedVersion(w.real)).toBeUndefined(); // the project itself stays unpublished
  });

  it('an unknown project is refused without a trace', () => {
    const w = world();
    expect(() => w.refresher.refreshPreview('nope')).toThrow(/unknown project/);
  });
});

describe('refreshPreview: last good version', () => {
  it('a draft that does not compile keeps the last good version and reports stale; the next good save is ready', () => {
    const w = world();
    expect(w.refresher.refreshPreview('demo')).toMatchObject({ status: 'ready', version: 1 });
    w.save(overlay({ hide: ['types.baum.properties.gibtsnicht'] }));
    const stale = w.refresher.refreshPreview('demo');
    expect(stale).toMatchObject({ status: 'stale', version: 1 });
    expect(stale.problems).toBeGreaterThan(0);
    expect(deployedVersion(w.previewDb())?.version).toBe(1);
    expect(previewOf(w.control, w.project.id)?.status).toBe('stale');
    w.save(overlay({ hide: [HIDE_OPTION] }));
    expect(w.refresher.refreshPreview('demo')).toMatchObject({ status: 'ready', problems: 0, version: 2 });
    expect(previewOf(w.control, w.project.id)?.status).toBe('ready');
  });

  it('an overlay that is not YAML or fails the schema is stale too', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    w.save('extends: [unclosed');
    expect(w.refresher.refreshPreview('demo')).toMatchObject({ status: 'stale', version: 1 });
    w.save(stringify({ schema: 'ueberblick/1', extends: 'moves@1', bogus: true }));
    expect(w.refresher.refreshPreview('demo').status).toBe('stale');
  });
});

describe('refreshPreview: automatic value moves', () => {
  async function seeded() {
    const w = world();
    w.refresher.refreshPreview('demo');
    const db = w.previewDb();
    const store = composeProjectStore(db, { clock, log: logSpy().log, onOrphanedBlobs: () => undefined });
    const id = '00000000-0000-7000-8000-000000000001' as FeatureId;
    expect(
      store.submit({
        id: '10000000-0000-7000-8000-000000000001' as RunId,
        task: 'anlegen' as Key,
        actor: { id: 'root', kind: 'admin', roles: [] },
        configVersion: 1,
        featureId: id,
        input: { stage: 'kontrolliert', notiz: 'hallo' },
      }).outcome,
    ).toBe('accepted');
    const stageOf = (): Json | undefined =>
      (
        JSON.parse(
          db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id)
            ?.properties ?? '{}',
        ) as Record<string, Json>
      )['stage'];
    const moves = () =>
      createMoveExecutor(db, {
        store,
        ids: { runId: () => '20000000-0000-7000-8000-000000000001' as RunId },
        pause: () => Promise.resolve(),
      }).run();
    return { w, db, stageOf, moves };
  }

  it('a removed stage moves the preview features to the first remaining option through $move runs', async () => {
    const { w, db, stageOf, moves } = await seeded();
    expect(stageOf()).toBe('kontrolliert');
    w.save(overlay({ hide: [HIDE_OPTION] }));
    expect(w.refresher.refreshPreview('demo')).toMatchObject({ status: 'ready', version: 2 });
    await moves();
    expect(stageOf()).toBe('erfasst');
    expect(db.prepare<{ n: number }>("SELECT count(*) n FROM runs WHERE task = '$move'").get()?.n).toBe(1);
  });

  it('a removed property is discarded: no move, the deploy goes through', async () => {
    const { w, db, moves } = await seeded();
    w.save(overlay({ hide: ['types.baum.properties.notiz'] }));
    // the task form still names `notiz`, so hide the form field too
    w.save(overlay({ hide: ['types.baum.properties.notiz', 'tasks.anlegen.form.notiz'] }));
    expect(w.refresher.refreshPreview('demo')).toMatchObject({ status: 'ready', version: 2 });
    await moves();
    expect(db.prepare<{ n: number }>('SELECT count(*) n FROM deploy_moves').get()?.n).toBe(0);
  });
});

describe('isolation of the real project', () => {
  it('a refresh, a stale refresh and a value move leave the real project database unchanged', async () => {
    const w = world();
    deployProject(w.real, TEMPLATE, 'admin', { clock, afterDeploy: () => undefined });
    const before = counts(w.real);
    const versionsBefore = JSON.stringify(versions(w.real));
    w.refresher.refreshPreview('demo');
    w.save(overlay({ hide: [HIDE_OPTION] }));
    w.refresher.refreshPreview('demo');
    w.save(overlay({ hide: ['nope.nope'] }));
    w.refresher.refreshPreview('demo');
    // the draft table is the only thing a save (not the refresh) changes: compare everything else
    expect(counts(w.real)).toBe(before);
    expect(JSON.stringify(versions(w.real))).toBe(versionsBefore);
    expect(deployedVersion(w.real)?.version).toBe(1);
    expect(deployedVersion(w.previewDb())?.version).toBeGreaterThan(0);
  });
});
