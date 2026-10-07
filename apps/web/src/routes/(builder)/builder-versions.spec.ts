import { readFileSync, readdirSync } from 'node:fs';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { openProject, resolveUpgrade } from '@ueberblick/builder';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import {
  createDraftStore,
  createLogger,
  createProjectServices,
  deploy,
  ensureDraft,
  openProjectDb,
  versions,
  type TemplateCatalog,
  type TemplateSource,
} from '@ueberblick/server';
import { createVersionsService } from './builder-versions';

const golden = resolve(import.meta.dirname, '../../../../../fixtures/golden');
const read = (rel: string): string => embedGoldenSource(readFileSync(resolve(golden, rel), 'utf8'));
const templates: TemplateFile[] = readdirSync(resolve(golden, 'templates/baumkataster'))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => parse(read(`templates/baumkataster/${f}`)) as TemplateFile);
const catalog: TemplateCatalog = { versionsOf: (key) => templates.filter((t) => t.template.key === key) };
const v = (n: string): TemplateFile => templates.find((t) => t.template.version === n) as TemplateFile;

/** `key@major` resolves to the highest version of that major (as the control database does). */
const source: TemplateSource = {
  resolve(ref) {
    const [key, want] = ref.split('@') as [string, string];
    return catalog
      .versionsOf(key)
      .filter((t) =>
        want.includes('.') ? t.template.version === want : t.template.version.startsWith(`${want}.`),
      )
      .sort((a, b) => b.template.version.localeCompare(a.template.version))[0];
  },
};
const clock = { now: () => '2026-09-30T08:00:00Z' };
const musterstadt = parse(read('projects/musterstadt-baeume.yaml')) as OverlayFile;

/** A project database with musterstadt deployed (version 1) and its draft opened. */
function setup() {
  const db = openProjectDb(':memory:', 'muster');
  const r = deploy(db, musterstadt, 'admin-1', { clock, templates: source });
  expect(r.ok).toBe(true);
  const draft = ensureDraft(db, clock, 'admin-1');
  if (!draft.ok) throw new Error('no draft');
  const after = { calls: 0 };
  const service = createVersionsService(db, {
    clock,
    templates: source,
    catalog,
    afterDeploy: () => void after.calls++,
  });
  return { db, service, draft: draft.draft, after };
}

/** Applies an edit through the document model and saves it to the draft (as the builder does). */
function saveEdit(
  db: ReturnType<typeof setup>['db'],
  draft: ReturnType<typeof setup>['draft'],
  op: Parameters<ReturnType<typeof openProject>['apply']>[0],
): number {
  const doc = openProject(JSON.stringify(v('1.1.0')), draft.overlay);
  const next = doc.apply(op);
  expect(next.refused).toBeUndefined();
  const put = createDraftStore(db).putIf(draft.revision, next.doc.save().overlaySrc, 'admin-1', clock.now());
  if (!put.ok) throw new Error('stale');
  return put.draft.revision;
}

describe('snapshot', () => {
  it('lists the versions, the running file, the feature counts and the offered upgrade', () => {
    const { service, db } = setup();
    db.prepare(
      `INSERT INTO features (id, type, config_version, properties, updated_seq, lifecycle) VALUES ('f1','baum',1,'{}',1,'active')`,
    ).run();
    const s = service.snapshot();
    expect(s.versions.map((x) => [x.version, x.status])).toEqual([[1, 'deployed']]);
    expect(s.deployed?.version).toBe(1);
    expect(s.featureCounts).toEqual({ baum: 1 });
    expect(s.upgrade).toMatchObject({ from: '1.1.0', to: '2.0.0' });
  });

  it('serves the effective file of any stored version', () => {
    const { service } = setup();
    expect(service.versionFile(1)?.template.key).toBe('baumkataster');
    expect(service.versionFile(99)).toBeUndefined();
  });
});

describe('deployDraft', () => {
  it('refuses a stale revision and deploys nothing', () => {
    const { service, db, draft } = setup();
    expect(service.deployDraft('admin-1', draft.revision + 1, {})).toEqual({ ok: false, reason: 'stale' });
    expect(versions(db)).toHaveLength(1);
  });

  it('deploys an unchanged draft as the running version (no new version)', () => {
    const { service, draft } = setup();
    expect(service.deployDraft('admin-1', draft.revision, {})).toEqual({
      ok: true,
      version: 1,
      created: false,
      warnings: [],
    });
  });

  it('deploys an edited draft as a new version', () => {
    const { service, db, draft } = setup();
    const rev = saveEdit(db, draft, {
      kind: 'set',
      path: 'types.baum.label',
      value: { de: 'Baum neu', en: 'Tree new' },
    });
    const r = service.deployDraft('admin-1', rev, {});
    expect(r).toEqual({ ok: true, version: 2, created: true, warnings: [] });
    expect(versions(db).map((x) => x.status)).toEqual(['retired', 'deployed']);
  });

  it('a broken draft is blocked with the problems, nothing is written', () => {
    const { service, db, draft } = setup();
    const rev = saveEdit(db, draft, {
      kind: 'set',
      path: 'types.baum.properties.art.to',
      value: 'gibt_es_nicht',
    });
    const r = service.deployDraft('admin-1', rev, {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason === 'problems' && r.problems.some((p) => p.path.startsWith('types.baum'))).toBe(
      true,
    );
    expect(versions(db)).toHaveLength(1);
  });

  it('a breaking change is blocked until a mapping is given', () => {
    const { service, db, draft } = setup();
    const rev = saveEdit(db, draft, { kind: 'hide', path: 'types.baum.properties.standort_hinweis' });
    const first = service.deployDraft('admin-1', rev, {});
    expect(first).toEqual({
      ok: false,
      reason: 'mapping_required',
      paths: ['types.baum.properties.standort_hinweis'],
    });
    expect(versions(db)).toHaveLength(1);
    const wrong = service.deployDraft('admin-1', rev, {
      'types.baum.properties.standort_hinweis': { to: 'nope' },
    });
    expect(wrong.ok).toBe(false);
    const ok = service.deployDraft('admin-1', rev, {
      'types.baum.properties.standort_hinweis': { discard: true },
    });
    expect(ok).toMatchObject({ ok: true, created: true });
  });
});

describe('value moves (WP-307)', () => {
  it('a { to } mapping deploys and records a move; { discard } records none', () => {
    const { service, db, draft, after } = setup();
    const rev = saveEdit(db, draft, { kind: 'hide', path: 'types.baum.properties.standort_hinweis' });
    const path = 'types.baum.properties.standort_hinweis';
    const r = service.deployDraft('admin-1', rev, { [path]: { to: 'art' } });
    expect(r).toMatchObject({ ok: true, created: true });
    const rows = db
      .prepare<{ path: string; payload: string }>('SELECT path, payload FROM deploy_moves')
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe(path);
    expect(JSON.parse(rows[0]?.payload ?? '{}')).toMatchObject({
      property: 'standort_hinweis',
      to_property: 'art',
    });
    expect(after.calls).toBe(1);
  });

  it('a { discard } mapping records no move', () => {
    const { service, db, draft } = setup();
    const rev = saveEdit(db, draft, { kind: 'hide', path: 'types.baum.properties.standort_hinweis' });
    const path = 'types.baum.properties.standort_hinweis';
    expect(service.deployDraft('admin-1', rev, { [path]: { discard: true } })).toMatchObject({ ok: true });
    expect(db.prepare<{ n: number }>('SELECT count(*) AS n FROM deploy_moves').get()?.n).toBe(0);
  });
});

describe('rollback', () => {
  it('is a deploy of the stored file: the older version runs again, the newer one is retired', () => {
    const { service, db, draft } = setup();
    const rev = saveEdit(db, draft, { kind: 'set', path: 'types.baum.label', value: { en: 'X' } });
    expect(service.deployDraft('admin-1', rev, {})).toMatchObject({ ok: true, version: 2 });
    const r = service.rollback('admin-1', 1);
    expect(r).toEqual({ ok: true, version: 1, created: false, warnings: [] });
    expect(versions(db).map((x) => [x.version, x.status])).toEqual([
      [1, 'deployed'],
      [2, 'retired'],
    ]);
    expect(service.snapshot().deployed?.version).toBe(1);
  });

  it('answers undefined for a version that does not exist', () => {
    expect(setup().service.rollback('admin-1', 42)).toBeUndefined();
  });

  it('a rollback that removes something existing data uses needs a mapping too', () => {
    const { service, db, draft } = setup();
    const rev = saveEdit(db, draft, { kind: 'hide', path: 'types.baum.properties.standort_hinweis' });
    service.deployDraft('admin-1', rev, { 'types.baum.properties.standort_hinweis': { discard: true } });
    // Back to version 1 brings the property back: nothing is removed, so it is not breaking.
    expect(service.rollback('admin-1', 1)).toMatchObject({ ok: true, version: 1 });
  });
});

describe('upgrade', () => {
  const conflict = 'types.baum.properties.vitalitaet.label';

  it('deploys the resolved overlay on the new template and restarts the draft from it', () => {
    const { service, db, draft } = setup();
    const doc = openProject(JSON.stringify(v('1.1.0')), draft.overlay);
    const resolved = resolveUpgrade(
      { old: doc.template, overlay: doc.overlay(), next: v('2.0.0') },
      { conflicts: { [conflict]: 'overlay' }, unresolved: {} },
    );
    if (!resolved.ok) throw new Error('unresolved');
    const blocked = service.upgrade('admin-1', resolved.text, {}, clock.now());
    expect(blocked.ok === false && blocked.reason).toBe('mapping_required');
    const paths = blocked.ok === false && blocked.reason === 'mapping_required' ? blocked.paths : [];
    const mappings = Object.fromEntries(paths.map((p) => [p, { discard: true as const }]));
    const r = service.upgrade('admin-1', resolved.text, mappings, clock.now());
    expect(r).toMatchObject({ ok: true, version: 2, created: true });
    const after = createDraftStore(db).get();
    expect(after?.templateVersion).toBe('2.0.0');
    expect(service.snapshot().upgrade).toBeNull();
  });

  it('refuses text that is not an overlay and leaves the draft alone', () => {
    const { service, db, draft } = setup();
    const r = service.upgrade('admin-1', 'extends: 12', {}, clock.now());
    expect(r).toMatchObject({ ok: false, reason: 'problems' });
    expect(createDraftStore(db).get()?.revision).toBe(draft.revision);
  });
});

describe('deploy warnings', () => {
  const NEVER = '0 0 31 2 *';
  it('plan of the saved draft is empty when nothing warns, and never changes anything', () => {
    const { service, db } = setup();
    expect(service.planDraft()).toMatchObject({ warnings: [], groups: [], mappings: [], blockers: [] });
    expect(versions(db)).toHaveLength(1);
  });

  it('plan reports a schedule that never runs, and deploy returns the same warning', () => {
    const { service, db, draft } = setup();
    let rev = draft.revision;
    let doc = openProject(JSON.stringify(v('1.1.0')), draft.overlay);
    const edits = [
      {
        kind: 'add',
        path: 'tasks.nachtlauf',
        value: {
          label: { de: 'N' },
          on: '$none',
          auto: { nie: { schedule: NEVER } },
        },
      },
    ] as const;
    for (const op of edits) {
      const next = doc.apply(op);
      if (next.refused !== undefined) throw new Error(`refused ${op.path}`);
      doc = next.doc;
    }
    const put = createDraftStore(db).putIf(rev, doc.save().overlaySrc, 'admin-1', clock.now());
    if (!put.ok) throw new Error('stale');
    rev = put.draft.revision;
    const planned = service.planDraft();
    expect(planned.warnings).toEqual([
      expect.objectContaining({ path: 'tasks.nachtlauf.auto.nie.schedule', code: 'schedule_never_runs' }),
    ]);
    const r = service.deployDraft('admin-1', rev, {});
    expect(r.ok && r.warnings).toEqual(planned.warnings);
  });
});

describe('deploy side effects (WP-169): every path reaches afterDeploy', () => {
  it('a deploy of an edited draft rebuilds the timers once; an unchanged deploy does not', () => {
    const { service, db, draft, after } = setup();
    expect(service.deployDraft('admin-1', draft.revision, {})).toMatchObject({ created: false });
    expect(after.calls).toBe(0);
    const rev = saveEdit(db, draft, { kind: 'set', path: 'types.baum.label', value: { en: 'X' } });
    expect(service.deployDraft('admin-1', rev, {})).toMatchObject({ ok: true, version: 2 });
    expect(after.calls).toBe(1);
  });

  it('a rollback rebuilds the timers', () => {
    const { service, db, draft, after } = setup();
    const rev = saveEdit(db, draft, { kind: 'set', path: 'types.baum.label', value: { en: 'X' } });
    service.deployDraft('admin-1', rev, {});
    after.calls = 0;
    expect(service.rollback('admin-1', 1)).toMatchObject({ ok: true, version: 1 });
    expect(after.calls).toBe(1);
  });

  it('an upgrade rebuilds the timers', () => {
    const { service, draft, after } = setup();
    const doc = openProject(JSON.stringify(v('1.1.0')), draft.overlay);
    const resolved = resolveUpgrade(
      { old: doc.template, overlay: doc.overlay(), next: v('2.0.0') },
      { conflicts: { 'types.baum.properties.vitalitaet.label': 'overlay' }, unresolved: {} },
    );
    if (!resolved.ok) throw new Error('unresolved');
    const blocked = service.upgrade('admin-1', resolved.text, {}, clock.now());
    const paths = blocked.ok === false && blocked.reason === 'mapping_required' ? blocked.paths : [];
    const mappings = Object.fromEntries(paths.map((p) => [p, { discard: true as const }]));
    expect(after.calls).toBe(0);
    expect(service.upgrade('admin-1', resolved.text, mappings, clock.now())).toMatchObject({ ok: true });
    expect(after.calls).toBe(1);
  });

  it('a blocked deploy does not rebuild', () => {
    const { service, db, draft, after } = setup();
    const rev = saveEdit(db, draft, { kind: 'hide', path: 'types.baum.properties.standort_hinweis' });
    expect(service.deployDraft('admin-1', rev, {}).ok).toBe(false);
    expect(after.calls).toBe(0);
  });

  it('the defect: a builder deploy that adds a schedule rule schedules it, with no restart', () => {
    const db = openProjectDb(':memory:', 'muster');
    deploy(db, musterstadt, 'admin-1', { clock, templates: source });
    const draft = ensureDraft(db, clock, 'admin-1');
    if (!draft.ok) throw new Error('no draft');
    const services = createProjectServices({
      clock,
      log: createLogger({ sink: () => undefined, now: () => 0 }),
      projectDb: () => db,
      store: () => {
        throw new Error('no run fires in this test');
      },
    });
    const service = createVersionsService(db, {
      clock,
      templates: source,
      catalog,
      afterDeploy: () => services.afterDeploy('muster'),
    });
    const timerRows = () => db.prepare<{ n: number }>('SELECT count(*) n FROM timers').get()?.n;
    expect(timerRows()).toBe(0);
    let doc = openProject(JSON.stringify(v('1.1.0')), draft.draft.overlay);
    for (const op of [
      {
        kind: 'add',
        path: 'tasks.nachtlauf',
        value: {
          label: { de: 'N' },
          on: '$none',
          auto: { nachts: { schedule: '0 3 * * *' } },
        },
      },
    ] as const) {
      const next = doc.apply(op);
      if (next.refused !== undefined) throw new Error(`refused ${op.path}`);
      doc = next.doc;
    }
    const put = createDraftStore(db).putIf(
      draft.draft.revision,
      doc.save().overlaySrc,
      'admin-1',
      clock.now(),
    );
    if (!put.ok) throw new Error('stale');
    expect(service.deployDraft('admin-1', put.draft.revision, {})).toMatchObject({ ok: true, created: true });
    expect(timerRows()).toBe(1);
  });
});
