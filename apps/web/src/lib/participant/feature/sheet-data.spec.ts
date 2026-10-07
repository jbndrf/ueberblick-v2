import { describe, expect, it, vi } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type {
  Actor,
  FeatureId,
  FeatureState,
  Instant,
  Key,
  RecordedObservation,
  RunId,
} from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { goldenConfig } from '@ueberblick/core/testing';
import type { RunSubmitter } from '@ueberblick/ui';
import { createDeviceIds } from '../ids';
import { createReader, type ActivitySource } from '../reader';
import { activityFor, sheetModelFor, startTask } from './sheet-data';

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const at = () => '2026-09-30T10:00:00.000Z' as Instant;
const tree: FeatureState = {
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  properties: {
    geometrie: { type: 'Point', coordinates: [7.1, 50.7] },
    stage: 'erfasst',
    beschreibung: 'Alte Eiche',
    befund: 'Rinde gesund',
    intern_notiz: 'Nur fuer das Team',
  } as never,
  lifecycle: 'active',
  updatedSeq: 3,
};
const measure: FeatureState = {
  id: 'm1' as FeatureId,
  type: 'massnahme' as Key,
  properties: { baum: 't1', art: 'schnitt', erledigt_am: null } as never,
  lifecycle: 'active',
  updatedSeq: 4,
};
const byId = new Map([tree, measure].map((f) => [f.id, f]));
const facts: Facts = {
  feature: (id) => byId.get(id),
  near: () => [],
  ofType: () => [],
  edgesFrom: () => [],
  edgesTo: () => [],
  history: () => [],
  observationsByActor: () => [],
  featuresWith: () => [],
  createdBy: () => 0,
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

const deps = (role: string) => {
  const actor: Actor = { id: 'anna', kind: 'participant', roles: [role as Key] };
  const ids = createDeviceIds({ now: at }, (n) => new Uint8Array(n));
  const reader = createReader({
    facts,
    versions: { deployed: 1, get: () => config },
    bootstrapVersion: 1,
    actor,
    geo: createGeo(),
    clock: { now: at },
    ids,
    locale: 'de',
    activity: noActivity,
    actorName: 'Anna',
  });
  return { reader, config, actor, ids };
};

describe('sheetModelFor, the language of the person (WP-713)', () => {
  it('labels the rows in the language the person chose now, not the one the device was opened with', () => {
    const labelOf = (locale?: string) =>
      sheetModelFor(deps('verwaltung'), tree.id, locale)?.rows.find((r) => r.key === 'befund')?.label;
    expect(labelOf()).toBe('Befund');
    expect(labelOf('en')).toBe('Finding');
  });

  it('names the changed property of the timeline in that language', () => {
    const view = activityFor(deps('verwaltung'), tree.id, 'en');
    expect(view).toBeDefined();
  });
});

describe('sheetModelFor', () => {
  it('shows the readable properties in config order; a property the role may not read is absent', () => {
    const verwaltung = sheetModelFor(deps('verwaltung'), tree.id);
    const keys = verwaltung?.rows.map((r) => r.key) ?? [];
    expect(keys).toContain('intern_notiz');
    const bauhof = sheetModelFor(deps('bauhof'), tree.id);
    const hidden = bauhof?.rows.map((r) => r.key) ?? [];
    expect(hidden).not.toContain('intern_notiz');
    expect(hidden).toContain('befund');
    const declared = Object.keys(config.file.types?.['baum']?.properties ?? {});
    expect(hidden).toEqual(declared.filter((k) => hidden.includes(k as Key)));
  });

  it('shows no row for the geometry property or the stage property (v3 isReadableDataField, state.svelte.ts:463-471)', () => {
    const d = deps('verwaltung');
    const keys = sheetModelFor(d, tree.id)?.rows.map((r) => r.key) ?? [];
    const type = config.file.types?.['baum'];
    expect(type?.geometry).toBe('geometrie');
    expect(type?.process?.property).toBe('stage');
    expect(keys).not.toContain('geometrie');
    expect(keys).not.toContain('stage');
    expect(keys).toContain('beschreibung');
    const layout = sheetModelFor(d, tree.id)?.layout.tabs.flatMap((t) => t.rows.map((r) => r.key)) ?? [];
    expect(layout).not.toContain('geometrie');
    expect(layout).not.toContain('stage');
  });

  it('is undefined for a feature that is not on the device', () => {
    expect(sheetModelFor(deps('bauhof'), 'gone' as FeatureId)).toBeUndefined();
  });
});

describe('activityFor (WP-634)', () => {
  const obs = (n: number, property: string, result: unknown): RecordedObservation => ({
    featureId: tree.id,
    property,
    result: result as never,
    seq: n,
    runId: 'r1' as RunId,
  });
  const withRuns = (role: string, own: string) => {
    const d = deps(role);
    const source: ActivitySource = {
      ...noActivity,
      activityWarm: () => true,
      observationsOf: () => [obs(2, 'befund', 'neu'), obs(1, 'intern_notiz', 'geheim')],
      runMeta: () => ({
        id: 'r1' as RunId,
        task: 'kontrolle',
        actor: 'anna',
        clientTime: Date.parse(at()),
        receivedAt: Date.parse(at()),
        seq: 1,
        causedBy: null,
      }),
    };
    const reader = createReader({
      facts,
      versions: { deployed: 1, get: () => config },
      bootstrapVersion: 1,
      actor: d.actor,
      geo: createGeo(),
      clock: { now: at },
      ids: d.ids,
      locale: 'de',
      activity: source,
      actorName: own,
    });
    return { ...d, reader };
  };

  it('lists only values the role may read', () => {
    const fields = (role: string) =>
      activityFor(withRuns(role, 'Anna'), tree.id)?.segments.flatMap((s) =>
        s.entries.flatMap((e) => e.fields.map((f) => f.key)),
      );
    expect(fields('verwaltung')).toEqual(expect.arrayContaining(['befund', 'intern_notiz']));
    expect(fields('bauhof')).toEqual(['befund']);
  });

  it('is undefined for a feature that is not on the device', () => {
    expect(activityFor(withRuns('bauhof', 'Anna'), 'gone' as FeatureId)).toBeUndefined();
  });

  it('the header time is the last change of the sync row', () => {
    const d = withRuns('bauhof', 'Anna');
    const input = d.reader.sheetInput(tree.id);
    const reader = {
      ...d.reader,
      sheetInput: () =>
        input && {
          ...input,
          feature: { ...input.feature, changedAt: '2026-09-29T08:00:00.000Z' as Instant },
        },
    };
    expect(sheetModelFor({ ...d, reader } as never, tree.id)?.updatedAt).toBe('2026-09-29T08:00:00.000Z');
  });
});

describe('startTask', () => {
  const submitter = () => {
    const submit = vi.fn(async () => 'queued' as const);
    return { submit, outcome: () => () => undefined } satisfies RunSubmitter;
  };

  it('a task without a form submits on tap, with its feature and no input', async () => {
    const s = submitter();
    const d = deps('bauhof');
    const result = await startTask(
      { config, submitter: s, ids: d.ids },
      'massnahme_erledigen' as Key,
      measure.id,
    );
    expect(result).toBe('submitted');
    expect(s.submit).toHaveBeenCalledTimes(1);
    expect(s.submit).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'massnahme_erledigen', featureId: 'm1', input: {} }),
    );
  });

  it('a task with a form is left to the task sheet and submits nothing', async () => {
    const s = submitter();
    const result = await startTask(
      { config, submitter: s, ids: deps('kontrolle').ids },
      'kontrolle' as Key,
      tree.id,
    );
    expect(result).toBe('form');
    expect(s.submit).not.toHaveBeenCalled();
  });
});
