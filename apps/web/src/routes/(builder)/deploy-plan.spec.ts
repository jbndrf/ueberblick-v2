// WP-360: the dry run the deploy overview reads (diff per Objektart, counts, mappings, blockers) and the deploy that
// takes the admin's choices. The engine's own behaviour is proven in packages/server (value-moves, pinning-deploy).
import { readFileSync, readdirSync } from 'node:fs';
import { embedGoldenSource } from '@ueberblick/core/testing';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { openProject } from '@ueberblick/builder';
import type { OverlayFile, TemplateFile } from '@ueberblick/core';
import {
  createDraftStore,
  deploy,
  ensureDraft,
  openProjectDb,
  type PinDeps,
  type TemplateCatalog,
  type TemplateSource,
} from '@ueberblick/server';
import { holdOf, mappingsToSend } from '../../lib/admin/deploy/overview-model';
import { createVersionsService } from './builder-versions';

const golden = resolve(import.meta.dirname, '../../../../../fixtures/golden');
const read = (rel: string): string => embedGoldenSource(readFileSync(resolve(golden, rel), 'utf8'));
const templates: TemplateFile[] = readdirSync(resolve(golden, 'templates/baumkataster'))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => parse(read(`templates/baumkataster/${f}`)) as TemplateFile);
const catalog: TemplateCatalog = { versionsOf: (key) => templates.filter((t) => t.template.key === key) };
const v = (n: string): TemplateFile => templates.find((t) => t.template.version === n) as TemplateFile;
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
const clock = { now: () => '2026-10-02T08:00:00Z' };
const musterstadt = parse(read('projects/musterstadt-baeume.yaml')) as OverlayFile;

/** A project at version 1 with its draft; the fake pin store records the pins like the real `$pin` run does. */
function setup() {
  const db = openProjectDb(':memory:', 'muster');
  expect(deploy(db, musterstadt, 'admin-1', { clock, templates: source }).ok).toBe(true);
  const ensured = ensureDraft(db, clock, 'admin-1');
  if (!ensured.ok) throw new Error('no draft');
  const pinned: string[] = [];
  const pins: PinDeps = {
    store: {
      submitBatch(runs) {
        for (const r of runs) {
          pinned.push(r.featureId as string);
          db.prepare('UPDATE features SET pinned_version = ? WHERE id = ?').run(
            (r.input as { version: number }).version,
            r.featureId ?? null,
          );
        }
        return { outcome: 'accepted' } as never;
      },
    },
    ids: { runId: () => `run-${pinned.length}` as never },
  };
  const service = createVersionsService(db, {
    clock,
    templates: source,
    catalog,
    afterDeploy: () => undefined,
    pins,
  });
  const feature = (id: string, props: Record<string, unknown>, lifecycle = 'active'): void => {
    db.prepare(
      `INSERT INTO features (id, type, config_version, properties, updated_seq, lifecycle) VALUES (?, 'baum', 1, ?, 1, ?)`,
    ).run(id, JSON.stringify(props), lifecycle);
  };
  let revision = ensured.draft.revision;
  const edit = (op: Parameters<ReturnType<typeof openProject>['apply']>[0]): number => {
    const draft = createDraftStore(db).get();
    if (!draft) throw new Error('no draft');
    const next = openProject(JSON.stringify(v('1.1.0')), draft.overlay).apply(op);
    expect(next.refused).toBeUndefined();
    const put = createDraftStore(db).putIf(revision, next.doc.save().overlaySrc, 'admin-1', clock.now());
    if (!put.ok) throw new Error('stale');
    revision = put.draft.revision;
    return revision;
  };
  return { db, service, feature, edit, pinned };
}

const LABEL = { kind: 'set', path: 'types.baum.label', value: { de: 'Baum neu', en: 'Tree new' } } as const;
const HIDE = { kind: 'hide', path: 'types.baum.properties.standort_hinweis' } as const;

describe('planDraft (the deploy overview)', () => {
  it('lists a change per Objektart in plain words, with the live Objekte and no mapping or blocker', () => {
    const { service, feature, edit } = setup();
    feature('f1', {});
    const revision = edit(LABEL);
    const plan = service.planDraft({ locale: 'de' });
    expect(plan).toMatchObject({ revision, first: false, mappings: [], blockers: [] });
    const baum = plan.groups.find((g) => g.type === 'baum');
    expect(baum).toMatchObject({ isNew: false, isRemoved: false, objects: 1 });
    expect(baum?.entries.map((e) => [e.path, e.change])).toContainEqual(['types.baum', 'changed']);
  });

  it('writes nothing, and an unchanged draft has no groups', () => {
    const { service, db } = setup();
    expect(service.planDraft({})).toMatchObject({ groups: [], mappings: [] });
    expect(db.prepare<{ n: number }>('SELECT count(*) AS n FROM config_versions').get()?.n).toBe(1);
  });

  it('a removed property with values asks for a mapping: the count, the targets with their labels', () => {
    const { service, feature, edit } = setup();
    feature('f1', { standort_hinweis: 'am Weg' });
    feature('f2', { standort_hinweis: 'hinten' });
    feature('f3', {});
    edit(HIDE);
    const plan = service.planDraft({ locale: 'de' });
    const m = plan.mappings.find((x) => x.path === 'types.baum.properties.standort_hinweis');
    expect(m).toMatchObject({ type: 'baum', affected: 2, stage: false });
    expect(m?.choices.map((c) => c.key)).toContain('art');
    expect(m?.choices.find((c) => c.key === 'art')?.label).toBe('Baumart');
    const entry = plan.groups
      .find((g) => g.type === 'baum')
      ?.entries.find((e) => e.path === 'types.baum.properties.standort_hinweis');
    expect(entry).toMatchObject({ change: 'removed', breaking: true, affected: 2 });
  });

  it('counts the running Objekte of a changed Objektart for the choice "belassen / verschieben"', () => {
    const { service, feature, edit } = setup();
    feature('f1', {});
    feature('f2', {});
    feature('f3', {}, 'completed');
    edit(LABEL);
    const plan = service.planDraft({ choices: { baum: 'keep' } });
    expect(plan.versions).toEqual([
      { type: 'baum', running_floating: 2, already_pinned: 0, settled_floating: 1 },
    ]);
  });

  it('shows the blockers of Doc.problems() in the asked language', () => {
    const { service, edit } = setup();
    edit({ kind: 'set', path: 'types.baum.properties.art.to', value: 'gibt_es_nicht' });
    const plan = service.planDraft({ locale: 'de' });
    expect(plan.blockers.length).toBeGreaterThan(0);
    expect(plan.blockers[0]).toMatchObject({ type: 'baum' });
    expect(plan.blockers.some((b) => b.path.startsWith('types.baum'))).toBe(true);
  });

  it('a choice for an Objektart without running Objekte is refused as a blocker', () => {
    const { service, edit } = setup();
    edit(LABEL);
    expect(service.planDraft({ choices: { baum: 'keep' } }).blockers.length).toBeGreaterThan(0);
  });
});

describe('a deleted relation (WP-365): "Werte verwerfen" lets the admin publish', () => {
  const RELATION = 'types.baum.relations.randlage';

  it('is a mapping row like a removed property, answered with discard, and the deploy goes through', () => {
    const { service, edit } = setup();
    const revision = edit({ kind: 'hide', path: RELATION });
    const plan = service.planDraft({ locale: 'de' });
    const row = plan.mappings.find((m) => m.path === RELATION);
    expect(row).toMatchObject({ type: 'baum', affected: 0 });
    // The overview sends discard for it (no Objekt holds a value of a relation), so nothing blocks the publish.
    const sent = mappingsToSend(plan, {}, {});
    expect(sent[RELATION]).toEqual({ discard: true });
    expect(holdOf(plan, {}, {})).toBeNull();
    expect(service.deployDraft('admin-1', revision, {}, {})).toMatchObject({
      ok: false,
      reason: 'mapping_required',
    });
    expect(service.deployDraft('admin-1', revision, sent, {})).toMatchObject({ ok: true });
  });
});

describe('deployDraft with the overview choices', () => {
  it('"belassen" pins the running Objekte to the old version; "verschieben" pins none', () => {
    const kept = setup();
    kept.feature('f1', {});
    const revision = kept.edit(LABEL);
    expect(kept.service.deployDraft('admin-1', revision, {}, { baum: 'keep' })).toMatchObject({ ok: true });
    expect(kept.pinned).toEqual(['f1']);
    expect(
      kept.db.prepare<{ p: number | null }>("SELECT pinned_version AS p FROM features WHERE id = 'f1'").get()
        ?.p,
    ).toBe(1);

    const moved = setup();
    moved.feature('f1', {});
    const rev = moved.edit(LABEL);
    expect(moved.service.deployDraft('admin-1', rev, {}, { baum: 'move' })).toMatchObject({ ok: true });
    expect(moved.pinned).toEqual([]);
  });

  it('a mapping and a choice go together: the values move, the kept Objekte stay', () => {
    const { service, db, feature, edit } = setup();
    feature('f1', { standort_hinweis: 'x' });
    edit(LABEL);
    const revision = edit(HIDE);
    const path = 'types.baum.properties.standort_hinweis';
    expect(
      service.deployDraft('admin-1', revision, { [path]: { to: 'art' } }, { baum: 'move' }),
    ).toMatchObject({
      ok: true,
    });
    expect(db.prepare<{ n: number }>('SELECT count(*) AS n FROM deploy_moves').get()?.n).toBe(1);
  });
});

describe('compareFiles (Projektdatei vergleichen, WP-506)', () => {
  it('the live and the draft file as YAML: they differ in the edited label only', () => {
    const { service, edit } = setup();
    const same = service.compareFiles();
    expect(same.live).not.toBeNull();
    expect(same.draft).toBe(same.live);
    edit(LABEL);
    const { live, draft } = service.compareFiles();
    expect(live).toBe(same.live);
    expect(draft).toContain('Baum neu');
    expect(live).not.toContain('Baum neu');
  });
});
