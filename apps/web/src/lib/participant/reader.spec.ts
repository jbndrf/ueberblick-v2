import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { createDeviceIds } from './ids';
import { goldenAssets, goldenConfig } from '@ueberblick/core/testing';
import { compile } from '@ueberblick/core/compile';
import type { CompiledConfig } from '@ueberblick/core/compile';
import type { RecordedObservation, RunId } from '@ueberblick/core/model';
import type { SyncRun } from '@ueberblick/core/sync';
import { createReader, type ActivitySource } from './reader';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const geo = createGeo();
const at = () => '2026-09-30T10:00:00.000Z' as Instant;
const tree: FeatureState = {
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  properties: {
    geometrie: { type: 'Point', coordinates: [7.1, 50.7] },
    stage: 'erfasst',
    vitalitaet: 'v1',
    beschreibung: 'Alte Eiche',
    befund: 'Rinde gesund',
  } as never,
  lifecycle: 'active',
  updatedSeq: 3,
};
const area: FeatureState = {
  id: 'a1' as FeatureId,
  type: 'flaeche' as Key,
  properties: { name: 'Stadtpark' } as never,
  lifecycle: 'active',
  updatedSeq: 1,
};
// the derived relation `flaeche` (within) that the task `kontrolle` binds as `area`
const inArea = { from: tree.id, relation: 'flaeche' as Key, to: area.id, derived: true };
const facts: Facts = {
  feature: (id) => (id === tree.id ? tree : id === area.id ? area : undefined),
  near: () => [],
  ofType: () => [],
  edgesFrom: (id, relation) =>
    id === tree.id && (relation === undefined || relation === inArea.relation) ? [inArea] : [],
  edgesTo: (id) => (id === area.id ? [inArea] : []),
  history: () => [],
  observationsByActor: () => [],
  createdBy: () => 0,
  featuresWith: () => [],
};
const noActivity: ActivitySource = {
  activityWarm: () => false,
  warmActivity: () => Promise.resolve(),
  observationsOf: () => [],
  runMeta: () => undefined,
  personName: () => undefined,
  queuedRunsOf: () => [],
  plannedChangesOf: () => [],
};
const reader = (roles: string[], activity: ActivitySource = noActivity, over: Facts = facts) => {
  const actor: Actor = { id: 'anna', kind: 'participant', roles: roles as Key[] };
  return createReader({
    facts: over,
    versions: { deployed: 1, get: () => config },
    bootstrapVersion: 1,
    actor,
    geo,
    clock: { now: at },
    ids: createDeviceIds({ now: at }, (n) => new Uint8Array(n)),
    locale: 'de',
    activity,
    actorName: 'Anna Beispiel',
  });
};

describe('reader', () => {
  it('startable tasks are the ones the role may run with no feature (core.plan decides)', () => {
    expect(reader(['kontrolle']).startableTasks()).toEqual(['erfassen']);
    expect([...reader(['verwaltung']).startableTasks()].sort()).toEqual([
      'baumart_anlegen',
      'erfassen',
      'flaeche_anlegen',
    ]);
    expect(reader(['bauhof']).startableTasks()).toEqual([]);
  });

  it('the tasks on a feature are the ones core.plan offers this actor, in config order', () => {
    expect(reader(['kontrolle']).availableTasks(tree.id)).toEqual([
      'kontrolle',
      'befund_ergaenzen',
      'verschieben',
    ]);
    expect(reader(['bauhof']).availableTasks(tree.id)).toEqual([]);
  });

  it('the task context binds self and the actor for the rule language', () => {
    const ctx = reader(['kontrolle']).taskContext(tree.id);
    expect(ctx.vars.get('self')).toEqual({ $feature: tree.id });
    expect(ctx.vars.get('actor')).toMatchObject({ id: 'anna', roles: ['kontrolle'] });
    expect(reader(['kontrolle']).taskContext().vars.has('self')).toBe(false);
  });

  it('form expressions read a hidden Objekt as absent (WP-816): the guard of scope()', () => {
    const file = structuredClone(config.file) as unknown as {
      types: Record<string, { permissions: unknown }>;
    };
    file.types['flaeche'] = {
      ...file.types['flaeche'],
      permissions: { see: ['verwaltung'], write: ['verwaltung'] },
    } as never;
    const r = compile(file as never, { assets: goldenAssets });
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    const hiddenArea: CompiledConfig = r.config;
    const read = (role: string) => {
      const actor: Actor = { id: 'anna', kind: 'participant', roles: [role] as Key[] };
      return createReader({
        facts,
        versions: { deployed: 1, get: () => hiddenArea },
        bootstrapVersion: 1,
        actor,
        geo,
        clock: { now: at },
        ids: createDeviceIds({ now: at }, (n) => new Uint8Array(n)),
        locale: 'de',
        activity: noActivity,
        actorName: 'Anna',
      }).taskContext(tree.id);
    };
    expect(read('kontrolle').features.property(area.id, 'name' as Key)).toBeUndefined();
    expect(read('kontrolle').features.type(area.id)).toBeUndefined();
    expect(read('verwaltung').features.property(area.id, 'name' as Key)).toBe('Stadtpark');
  });

  it('the sheet input carries the feature, its type, the tasks and the derived geometry values', () => {
    const input = reader(['kontrolle']).sheetInput(tree.id);
    expect(input?.type.label).toMatchObject({ de: 'Baum' });
    expect(input?.availableTasks).toContain('kontrolle');
    expect(input?.feature.derived['geometrie']?.pointOnSurface.coordinates).toEqual([7.1, 50.7]);
    expect(reader(['kontrolle']).sheetInput('gone' as FeatureId)).toBeUndefined();
  });

  it('a feature is named by its first required text value, else by its type and a short id (B-014)', () => {
    const r = reader(['kontrolle']);
    expect(r.labelOf(tree)).toBe('Baum #t1'); // befund and beschreibung are optional: not names
    expect(r.labelOf(area)).toBe('Stadtpark');
    expect(r.labelOf({ ...tree, properties: { geometrie: tree.properties['geometrie'] } as never })).toBe(
      `Baum #${tree.id.slice(-4)}`,
    );
    expect(r.labelOf({ ...tree, type: 'baumart' as Key, properties: { name_de: 'Eiche' } as never })).toBe(
      'Eiche',
    );
  });

  it('a reference picker shows the Anzeigefeld of the target when its property names one (A-048)', () => {
    const r = reader(['kontrolle']);
    const art = {
      ...tree,
      type: 'baumart' as Key,
      properties: { name_de: 'Eiche', name_lat: 'Quercus' } as never,
    };
    expect(r.labelOf(art, undefined, { display_property: 'name_lat' })).toBe('Quercus');
    expect(r.labelOf(art, undefined, {})).toBe('Eiche');
  });
});

describe('activityOf (WP-602)', () => {
  const run = (n: number, actor: string | null, task = 'kontrolle'): SyncRun => ({
    id: `r${n}` as RunId,
    task,
    actor,
    clientTime: Date.UTC(2026, 8, 1, n),
    receivedAt: Date.UTC(2026, 8, 1, n, 30),
    seq: n,
    causedBy: null,
  });
  const o = (n: number, property: string, result: unknown): RecordedObservation => ({
    featureId: tree.id,
    property,
    result: result as never,
    seq: n,
    runId: `r${n}` as RunId,
  });
  const runs = [run(1, 'anna'), run(2, null), run(3, 'bert', 'befund_ergaenzen'), run(4, 'anna')];
  const queued = (n: number, state: 'queued' | 'refused' | 'accepted', input: Record<string, unknown>) => ({
    order: n,
    run: {
      id: `r${n}` as RunId,
      task: 'kontrolle' as Key,
      actor: { id: 'anna', kind: 'participant' as const, roles: ['kontrolle' as Key] },
      configVersion: 1,
      featureId: tree.id,
      input: input as never,
      clientTime: '2026-09-02T08:00:00.000Z' as Instant,
    },
    blobs: [],
    blobMimes: {},
    state,
  });
  const source = (
    obs: RecordedObservation[],
    queue: ReturnType<typeof queued>[] = [],
    planned: Record<string, { property: string; result: unknown }[]> = {},
  ): ActivitySource => ({
    activityWarm: () => true,
    warmActivity: () => Promise.resolve(),
    observationsOf: () => [...obs].sort((a, b) => b.seq - a.seq),
    runMeta: (id) => runs.find((r) => r.id === id),
    personName: (id) => ({ anna: 'Anna Beispiel', bert: 'Bert Muster' })[id],
    queuedRunsOf: () => queue,
    plannedChangesOf: (runId, id) =>
      (planned[runId] ?? []).map((c) => ({ featureId: id, property: c.property, result: c.result })),
  });

  it('groups observations by run, newest first, with task label, actor name and the neutral label', () => {
    const obs = [
      o(1, 'vitalitaet', 'v1'),
      o(1, 'befund', 'a'),
      o(2, 'beschreibung', 'x'),
      o(3, 'befund', 'b'),
    ];
    const entries = reader(['kontrolle'], source(obs)).activityOf(tree.id);
    expect(entries.map((e) => e.runId)).toEqual(['r3', 'r2', 'r1']);
    expect(entries[0]).toMatchObject({
      task: 'Befund ergänzen',
      actorLabel: 'Bert Muster',
      status: 'accepted',
      // the server receive time (WP-794), not the work time (clientTime 03:00)
      at: '2026-09-01T03:30:00.000Z',
      changes: [{ property: 'befund', result: 'b' }],
    });
    expect(entries[1]?.actorLabel).toBe('Jemand'); // actor null: neutral label from the catalogue
    expect(entries[2]?.actorLabel).toBe('Anna Beispiel');
    expect(entries[2]?.changes.map((c) => c.property).sort()).toEqual(['befund', 'vitalitaet']);
  });

  it('keeps the changes of one run in the order the fold applies them (oldest seq first), so the last write is last', () => {
    const obs = [
      o(1, 'stage', 'entwurf'),
      { ...o(1, 'befund', 'a'), seq: 2 },
      { ...o(1, 'stage', 'eingereicht'), seq: 3 },
    ];
    const [entry] = reader(['kontrolle'], source(obs)).activityOf(tree.id);
    expect(entry?.changes.map((c) => c.result)).toEqual(['entwurf', 'a', 'eingereicht']);
  });

  it('shows pending and refused own runs on top with their values; an accepted one appears once', () => {
    const obs = [o(1, 'befund', 'a'), o(4, 'befund', 'accepted now')];
    const q = [
      queued(4, 'accepted', { befund: 'accepted now' }), // already pulled: the synced entry wins
      queued(5, 'queued', { befund: 'typed', not_a_property: 1 }),
      queued(6, 'refused', { vitalitaet: 'v3' }),
    ];
    const entries = reader(
      ['kontrolle'],
      source(obs, q, { r5: [{ property: 'befund', result: 'typed' }] }),
    ).activityOf(tree.id);
    expect(entries.map((e) => [e.runId, e.status])).toEqual([
      ['r6', 'refused'],
      ['r5', 'pending'],
      ['r4', 'accepted'],
      ['r1', 'accepted'],
    ]);
    expect(entries[1]?.changes).toEqual([{ property: 'befund', result: 'typed' }]);
    expect(entries[1]?.task).toBe('Kontrolle durchführen');
    expect(entries.filter((e) => e.runId === 'r4')).toHaveLength(1);
  });

  it('WP-854: a waiting run shows what the device planned (the stage move and rule-set fields), not the form input', () => {
    const q = [queued(5, 'queued', { vitalitaet: 'v4', befund: 'x' })];
    const planned = {
      r5: [
        { property: 'vitalitaet', result: 'v4' },
        { property: 'befund', result: 'x' },
        { property: 'stage', result: 'massnahme' },
        { property: 'faellig_am', result: '2026-10-12' },
      ],
    };
    const [entry] = reader(['kontrolle'], source([], q, planned)).activityOf(tree.id);
    expect(entry?.status).toBe('pending');
    expect(entry?.changes.map((c) => c.property)).toEqual(['vitalitaet', 'befund', 'stage', 'faellig_am']);
    expect(entry?.changes[2]?.result).toBe('massnahme');
  });

  it('own runs, synced or pending, always show the own name (the people table may not know it)', () => {
    const src: ActivitySource = {
      ...source([o(1, 'befund', 'a')], [queued(5, 'queued', { befund: 'typed' })]),
      personName: () => undefined,
    };
    const entries = reader(['kontrolle'], src).activityOf(tree.id);
    expect(entries.map((e) => e.actorLabel)).toEqual(['Anna Beispiel', 'Anna Beispiel']);
  });

  it('the sheet input carries the activity of a warm feature and nothing for a cold one', () => {
    const warm = reader(['kontrolle'], source([o(1, 'befund', 'a')])).sheetInput(tree.id);
    expect(warm?.activity).toHaveLength(1);
    expect(reader(['kontrolle']).sheetInput(tree.id)?.activity).toEqual([]);
  });
});

describe('WP-723: people by name, the live language', () => {
  const named: ActivitySource = {
    ...noActivity,
    personName: (id) => ({ bert: 'Bert Muster' })[id],
  };

  it('the participant lookup gives the name the device knows, the own name, and nothing for a stranger', () => {
    const { lookups } = reader(['kontrolle'], named).sheetInput(tree.id) ?? { lookups: undefined };
    expect(lookups?.participant('bert')).toBe('Bert Muster');
    expect(lookups?.participant('anna')).toBe('Anna Beispiel');
    expect(lookups?.participant('p-fremd')).toBeUndefined();
  });

  it('display names follow the language given per call, not the one the device opened with', () => {
    const measure: FeatureState = {
      ...tree,
      id: 'm1' as FeatureId,
      type: 'massnahme' as Key,
      properties: {} as never,
    };
    const r = reader(['kontrolle']);
    expect(r.labelOf(measure)).not.toBe(r.labelOf(measure, 'en'));
    expect(r.labelOf(measure, 'en')).toContain('Measure');
  });

  it('the feature lookup of the sheet input names the neighbour in the live language', () => {
    const r = reader(['kontrolle']);
    expect(r.sheetInput(tree.id, 'en')?.locale).toBe('en');
    expect(r.sheetInput(tree.id)?.locale).toBe('de');
  });
});

describe('audit fields on the sheet (WP-721)', () => {
  const audited: FeatureState = {
    ...tree,
    createdBy: 'bert',
    createdAt: '2026-05-01T08:00:00.000Z' as Instant,
  };
  const withAudit: Facts = { ...facts, feature: (id) => (id === tree.id ? audited : facts.feature(id)) };
  const people: ActivitySource = {
    ...noActivity,
    personName: (id) => ({ bert: 'Bert Muster' })[id],
  };

  it('the sheet input keeps createdAt and createdBy of the stored feature', () => {
    const feature = reader(['kontrolle'], noActivity, withAudit).sheetInput(tree.id)?.feature;
    expect(feature).toMatchObject({ createdBy: 'bert', createdAt: '2026-05-01T08:00:00.000Z' });
  });

  it('the creator is named where the device knows the person, the own name for the own actor', () => {
    const lookup = reader(['kontrolle'], people, withAudit).sheetInput(tree.id)?.lookups.participant;
    expect(lookup?.('bert')).toBe('Bert Muster');
    expect(lookup?.('anna')).toBe('Anna Beispiel');
    expect(lookup?.('unbekannt')).toBeUndefined();
  });
});
