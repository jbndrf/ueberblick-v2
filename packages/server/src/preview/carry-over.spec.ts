// WP-373 (A-034): preview logins per role plus "Keine Rolle", and the carry-over of the preview's data on a deploy of the
// real project: no drop, the same value moves as live, the tokens stay, a reset keeps the logins.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { FeatureId, Json, Key, RunId, TemplateFile } from '@ueberblick/core';
import { createProject } from '../admin/bootstrap';
import { createAuth, isAuthError, participantRolesOf } from '../auth';
import { createDraftStore, seedDraft } from '../builder-draft';
import { deployedVersion, deployProject, loadConfig } from '../deploy';
import { createMoveExecutor } from '../deploy/move-executor';
import type { Db } from '../db/driver';
import { openControlDb, openProjectDb, openProjectDbFile } from '../db/open';
import { composeProjectStore } from '../http/shared/stores';
import { logSpy } from '../store/run/log.testkit';
import { createPreviewRefresher } from './refresh';
import { dropPreview, ensurePreview, forgetPreview, previewDbPath, previewOf } from './registry';

const clock = { now: () => '2026-10-02T10:00:00Z' };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TEMPLATE = {
  schema: 'ueberblick/1',
  template: { key: 'moves', version: '1.0.0' },
  roles: { maker: { label: 'Maker' }, viewer: { label: 'Betrachter' } },
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
const TO_GEPRUEFT = { [HIDE_OPTION]: { to: 'geprueft' } };
const templates = { resolve: (ref: string) => (ref.startsWith('moves@') ? TEMPLATE : undefined) };

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-carry-'));
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
  let opened: Db | undefined;
  const previewDb = (): Db => (opened ??= openProjectDbFile(previewDbPath(dir, 'demo')));
  const auth = createAuth({
    control,
    now: () => new Date(clock.now()),
    participantRoles: (_project, participant) => participantRolesOf(previewDb(), participant),
  });
  const timers: Array<() => void> = [];
  const refresher = createPreviewRefresher({
    control,
    clock,
    templates,
    auth,
    project: (key) => (key === 'demo' ? project : undefined),
    draftDb: () => real,
    ensurePreview: (id) => ensurePreview(control, dir, id, clock),
    previewDb,
    afterDeploy: () => undefined,
    dropPreview: (id, opts) => {
      opened?.close();
      opened = undefined;
      dropPreview(control, dir, id, opts);
    },
    schedule: (fn) => {
      timers.push(fn);
      return () => undefined;
    },
  });
  const save = (text: string): void => {
    const d = createDraftStore(real).get();
    createDraftStore(real).putIf(d?.revision ?? 1, text, 'admin', clock.now());
  };
  const live = () => deployProject(real, TEMPLATE, 'admin', { clock, afterDeploy: () => undefined });
  return { dir, control, project, real, previewDb, refresher, save, auth, timers, live };
}

const tokenOf = (w: ReturnType<typeof world>, role: string | null): string | undefined =>
  w.refresher.previewLogins('demo').find((l) => l.role === role)?.token;

describe('preview logins', () => {
  it('each role of the draft plus "Keine Rolle" has a login; the token signs in as that role', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const logins = w.refresher.previewLogins('demo', 'de');
    expect(logins.map((l) => [l.role, l.label])).toEqual([
      ['maker', 'Maker'],
      ['viewer', 'Betrachter'],
      [null, ''],
    ]);
    for (const l of logins) {
      expect(l.link).toBe(`/login?token=${encodeURIComponent(l.token)}`);
      const s = w.auth.exchange(l.token);
      if (isAuthError(s)) throw new Error(s.code);
      expect(s.principal.projectId).toBe(previewOf(w.control, w.project.id)?.id);
      expect(s.principal.roles).toEqual(l.role === null ? [] : [l.role]);
    }
  });

  it('the tokens stay across draft saves', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const before = w.refresher.previewLogins('demo').map((l) => l.token);
    w.save(overlay({ hide: [HIDE_OPTION] }));
    w.refresher.refreshPreview('demo');
    expect(w.refresher.previewLogins('demo').map((l) => l.token)).toEqual(before);
  });

  it('a new role gets a login after the next save, and a removed role loses its login', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const viewer = tokenOf(w, 'viewer') ?? '';
    const maker = tokenOf(w, 'maker');
    w.save(overlay({ add: { 'roles.neu': { label: 'Neu' } }, hide: ['roles.viewer'] }));
    w.refresher.refreshPreview('demo');
    expect(w.refresher.previewLogins('demo').map((l) => l.role)).toEqual(['maker', 'neu', null]);
    expect(tokenOf(w, 'maker')).toBe(maker);
    const s = w.auth.exchange(tokenOf(w, 'neu') ?? '');
    expect(isAuthError(s) ? s.code : s.principal.roles).toEqual(['neu']);
    expect(isAuthError(w.auth.exchange(viewer))).toBe(true);
    expect(
      w.previewDb().prepare<{ id: string }>('SELECT id FROM participants ORDER BY id').all().length,
    ).toBe(3);
  });

  it('a project without a preview has no logins', () => {
    const w = world();
    expect(w.refresher.previewLogins('demo')).toEqual([]);
  });
});

describe('carry-over on a deploy of the real project', () => {
  async function seeded() {
    const w = world();
    w.live();
    w.refresher.refreshPreview('demo');
    const db = w.previewDb();
    const store = composeProjectStore(db, { clock, log: logSpy().log, onOrphanedBlobs: () => undefined });
    const submit = (n: number, stage: string): FeatureId => {
      const id = `00000000-0000-7000-8000-00000000000${n}` as FeatureId;
      const r = store.submit({
        id: `10000000-0000-7000-8000-00000000000${n}` as RunId,
        task: 'anlegen' as Key,
        actor: { id: 'root', kind: 'admin', roles: [] },
        configVersion: 1,
        featureId: id,
        input: { stage, notiz: 'Tester' },
      });
      expect(r.outcome).toBe('accepted');
      return id;
    };
    const demo = submit(1, 'kontrolliert');
    const tester = submit(2, 'kontrolliert');
    const stageOf = (id: FeatureId): Json | undefined =>
      (
        JSON.parse(
          db.prepare<{ properties: string }>('SELECT properties FROM features WHERE id = ?').get(id)
            ?.properties ?? '{}',
        ) as Record<string, Json>
      )['stage'];
    let n = 0;
    const moves = () =>
      createMoveExecutor(db, {
        store,
        ids: { runId: () => `20000000-0000-7000-8000-00000000${String(++n).padStart(4, '0')}` as RunId },
        pause: () => Promise.resolve(),
      }).run();
    return { w, db, demo, tester, stageOf, moves };
  }

  /** The live deploy of the removal with the admin's pick, the way the deploy overview sends it. */
  function publishRemoval(w: ReturnType<typeof world>): void {
    const file = { schema: 'ueberblick/1', extends: 'moves@1', hide: [HIDE_OPTION] } as const;
    w.save(overlay({ hide: [HIDE_OPTION] }));
    const r = deployProject(
      w.real,
      file as never,
      'admin',
      { clock, templates, afterDeploy: () => w.refresher.carryOver('demo') },
      TO_GEPRUEFT,
    );
    expect(r.ok).toBe(true);
  }

  it('the preview keeps its features, moved exactly as live, and the old tokens still sign in', async () => {
    const { w, db, demo, tester, stageOf, moves } = await seeded();
    const tokens = w.refresher.previewLogins('demo').map((l) => l.token);
    const before = db.prepare<{ n: number }>('SELECT count(*) n FROM features').get()?.n;
    publishRemoval(w);
    await moves();
    expect(db.prepare<{ n: number }>('SELECT count(*) n FROM features').get()?.n).toBe(before);
    expect([stageOf(demo), stageOf(tester)]).toEqual(['geprueft', 'geprueft']); // live's pick, not the first option
    expect(deployedVersion(db)?.version).toBe(2);
    expect(w.refresher.previewLogins('demo').map((l) => l.token)).toEqual(tokens);
    for (const t of tokens) expect(isAuthError(w.auth.exchange(t))).toBe(false);
  });

  it('without a draft the preview follows the live config; no preview, no work', async () => {
    const { w, db } = await seeded();
    w.real.prepare('DELETE FROM builder_draft').run();
    const file = { schema: 'ueberblick/1', extends: 'moves@1', hide: [HIDE_OPTION] } as never;
    deployProject(
      w.real,
      file,
      'admin',
      { clock, templates, afterDeploy: () => w.refresher.carryOver('demo') },
      TO_GEPRUEFT,
    );
    const cfg = loadConfig(db)?.file.types?.['baum']?.properties['stage'] as { options: object };
    expect(Object.keys(cfg.options)).toEqual(['erfasst', 'geprueft']);
    const none = world();
    expect(() => none.refresher.carryOver('demo')).not.toThrow();
    expect(previewOf(none.control, none.project.id)).toBeUndefined();
  });

  it('a preview that fails to carry over never fails the live deploy', () => {
    const w = world();
    w.live();
    w.refresher.refreshPreview('demo');
    w.real.prepare('UPDATE builder_draft SET overlay = ?').run('extends: [unclosed');
    expect(() => w.refresher.carryOver('demo')).not.toThrow();
    expect(w.refresher.previewState('demo').status).toBe('ready');
  });
});

describe('"Demo-Daten zurücksetzen" and project delete', () => {
  it('a reset regenerates the preview and leaves the logins: the same tokens sign in as the same roles', () => {
    const w = world();
    w.live();
    w.refresher.refreshPreview('demo');
    const before = w.refresher.previewLogins('demo');
    const old = w.auth.exchange(before[0]?.token ?? '');
    if (isAuthError(old)) throw new Error(old.code);
    w.refresher.resetPreview('demo');
    const after = w.refresher.previewLogins('demo');
    expect(after.map((l) => [l.role, l.token])).toEqual(before.map((l) => [l.role, l.token]));
    expect(after[0]?.participantId).not.toBe(before[0]?.participantId); // a fresh device store
    expect(w.auth.authenticate(old.id)).toBeNull(); // the old session ended with the old participant
    const again = w.auth.exchange(after[0]?.token ?? '');
    expect(isAuthError(again) ? again.code : again.principal.roles).toEqual(['maker']);
  });

  it('dropping the preview for good (project delete) removes the logins', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const token = tokenOf(w, 'maker') ?? '';
    dropPreview(w.control, w.dir, w.project.id);
    forgetPreview(w.control, w.project.id);
    expect(isAuthError(w.auth.exchange(token))).toBe(true);
  });
});
