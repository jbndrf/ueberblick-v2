// WP-342: demo data in the preview. $seed runs, spread stages, centre, references, first refresh only, reset, isolation.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadConfig } from '../deploy';
import { embedGoldenRefs } from '@ueberblick/core/testing';
import type { TemplateFile } from '@ueberblick/core';
import { createProject } from '../admin/bootstrap';
import { createAuth } from '../auth';
import { seedDraft } from '../builder-draft';
import { deployedVersion, versions } from '../deploy';
import type { Db } from '../db/driver';
import { openControlDb, openProjectDb, openProjectDbFile } from '../db/open';
import { logSpy } from '../store/run/log.testkit';
import { createPreviewRefresher } from './refresh';
import { dropPreview, ensurePreview, previewDbPath, previewOf } from './registry';
import { previewCenter, seedPreview } from './seed';

const clock = { now: () => '2026-10-01T10:00:00Z' };
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const TEMPLATE = embedGoldenRefs(
  parse(
    readFileSync(
      resolve(import.meta.dirname, '../../../../fixtures/golden/templates/baumkataster/1.1.0.yaml'),
      'utf8',
    ),
  ),
) as TemplateFile;

function world() {
  const dir = mkdtempSync(join(tmpdir(), 'ub-seed-'));
  dirs.push(dir);
  const control = openControlDb(':memory:');
  const project = createProject(control, { key: 'demo', name: 'Demo' }, clock);
  const real = openProjectDb(':memory:', 'demo');
  seedDraft(real, {
    template: 'baumkataster',
    templateVersion: '1.1.0',
    overlay: stringify({ schema: 'ueberblick/1', extends: 'baumkataster@1' }),
    by: 'admin',
    at: clock.now(),
  });
  let opened: Db | undefined;
  const previewDb = (): Db => (opened ??= openProjectDbFile(previewDbPath(dir, 'demo')));
  let seedCalls = 0;
  const refresher = createPreviewRefresher({
    control,
    clock,
    auth: createAuth({ control, now: () => new Date(clock.now()), participantRoles: () => [] }),
    templates: { resolve: (ref) => (ref.startsWith('baumkataster@') ? TEMPLATE : undefined) },
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
    seed: (_key, participant) => {
      seedCalls++;
      const db = previewDb();
      const config = loadConfig(db);
      if (config) seedPreview(db, config, { clock, log: logSpy().log, participant, seed: seedCalls });
    },
    schedule: () => () => undefined,
  });
  return { control, project, real, previewDb, refresher, calls: () => seedCalls };
}

interface Row {
  id: string;
  type: string;
  properties: string;
}
const features = (db: Db): Row[] =>
  db.prepare<Row>('SELECT id, type, properties FROM features ORDER BY id').all();
const props = (r: Row): Record<string, unknown> => JSON.parse(r.properties) as Record<string, unknown>;

describe('seedPreview of the golden baumkataster', () => {
  it('seeds 5 features per type, each created by a $seed system run, stages spread, near the centre', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const db = w.previewDb();
    const rows = features(db);
    const config = loadConfig(db);
    const types = Object.keys(config?.file.types ?? {});
    for (const t of types) expect(rows.filter((r) => r.type === t)).toHaveLength(5);
    const runs = db.prepare<{ task: string; actor: string }>('SELECT task, actor FROM runs').all();
    expect(runs).toHaveLength(types.length * 5);
    expect(new Set(runs.map((r) => r.task))).toEqual(new Set(['$seed']));
    expect(runs.every((r) => String(r.actor).includes('system'))).toBe(true);
    // every feature has a creating run: the observations carry a run id
    expect(
      db.prepare<{ n: number }>('SELECT count(*) n FROM observations WHERE run_id IS NULL').get()?.n,
    ).toBe(0);

    const trees = rows.filter((r) => r.type === 'baum');
    const stages = trees.map((r) => props(r)['stage']);
    expect(new Set(stages)).toEqual(new Set(['erfasst', 'kontrolliert', 'massnahme', 'erledigt']));
    expect(stages).toContain('erfasst');
    const [lon, lat] = previewCenter(config as NonNullable<typeof config>);
    for (const t of trees) {
      const g = props(t)['geometrie'] as { coordinates: [number, number] };
      const dx = (g.coordinates[0] - lon) * 111.32 * Math.cos((lat * Math.PI) / 180);
      const dy = (g.coordinates[1] - lat) * 111.32;
      expect(Math.hypot(dx, dy)).toBeLessThan(1);
    }
  });

  it('references resolve to generated features', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const rows = features(w.previewDb());
    const arten = new Set(rows.filter((r) => r.type === 'baumart').map((r) => r.id));
    const refs = rows.filter((r) => r.type === 'baum').map((r) => props(r)['art']);
    expect(refs.every((a) => typeof a === 'string' && arten.has(a))).toBe(true);
    const massnahmen = rows.filter((r) => r.type === 'massnahme').map((r) => props(r)['baum']);
    const baeume = new Set(rows.filter((r) => r.type === 'baum').map((r) => r.id));
    expect(massnahmen.every((b) => typeof b === 'string' && baeume.has(b))).toBe(true);
  });

  it('a later refresh does not add features', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const n = features(w.previewDb()).length;
    w.refresher.refreshPreview('demo');
    const d = w.real
      .prepare<{ revision: number; overlay: string }>('SELECT revision, overlay FROM builder_draft')
      .get();
    w.real
      .prepare('UPDATE builder_draft SET overlay = ?, revision = revision + 1')
      .run(`${d?.overlay ?? ''}\n# edited`);
    w.refresher.refreshPreview('demo');
    expect(features(w.previewDb())).toHaveLength(n);
    expect(w.calls()).toBe(1);
  });

  it('a reset gives a fresh set (new ids, generation bumped) and leaves the real project untouched', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const oldIds = new Set(features(w.previewDb()).map((r) => r.id));
    const generation = previewOf(w.control, w.project.id)?.generation ?? 0;
    const realBefore = JSON.stringify([
      w.real.prepare('SELECT count(*) n, max(seq) m FROM observations').get(),
      versions(w.real),
      deployedVersion(w.real),
    ]);
    const state = w.refresher.resetPreview('demo');
    expect(state.status).toBe('ready');
    const fresh = features(w.previewDb());
    expect(fresh.length).toBe(oldIds.size);
    expect(fresh.some((r) => oldIds.has(r.id))).toBe(false);
    expect(previewOf(w.control, w.project.id)?.generation).toBe(generation + 1);
    expect(
      JSON.stringify([
        w.real.prepare('SELECT count(*) n, max(seq) m FROM observations').get(),
        versions(w.real),
        deployedVersion(w.real),
      ]),
    ).toBe(realBefore);
    expect(w.real.prepare('SELECT count(*) n FROM runs').get()).toEqual({ n: 0 });
  });

  it('seeding 10 types x 5 features seeds without a refusal (time is logged, a one-off per preview)', () => {
    const w = world();
    w.refresher.refreshPreview('demo');
    const db = w.previewDb();
    const config = loadConfig(db);
    if (!config) throw new Error('no config');
    const t0 = performance.now();
    const r = seedPreview(db, config, { clock, log: logSpy().log, participant: 'p', perType: 10 });
    const ms = performance.now() - t0;
    expect(r.refused).toBe(0);
    console.info(`seed bench: ${r.seeded} features in ${ms.toFixed(0)} ms`);
  });
});
