// @vitest-environment jsdom
// WP-634: v3's Aktivität tab in the feature sheet, from device data (a real reader over a fake activity source).
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
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
import type { SyncRun } from '@ueberblick/core/sync';
import { goldenConfig } from '@ueberblick/core/testing';
import '@ueberblick/ui/testing';
import { createDeviceIds } from '../../ids';
import { createReader, type ActivitySource } from '../../reader';
import FeatureSheetHost from '../FeatureSheetHost.svelte';

afterEach(cleanup);
beforeEach(() => {
  window.innerWidth = 480;
});

const config = goldenConfig('templates/baumkataster/1.0.0.yaml');
const NOW = '2026-10-01T12:00:00.000Z' as Instant;
const hoursAgo = (h: number): number => Date.parse(NOW) - h * 3_600_000;
const tree = (extra: Partial<FeatureState> = {}): FeatureState => ({
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  properties: { stage: 'massnahme', befund: 'Rinde ok', beschreibung: 'Alte Eiche' } as never,
  lifecycle: 'active',
  updatedSeq: 9,
  ...extra,
});

const run = (n: number, actor: string | null, task: string, hours: number): SyncRun => ({
  id: `r${n}` as RunId,
  task,
  actor,
  clientTime: hoursAgo(hours),
  receivedAt: hoursAgo(hours),
  seq: n,
  causedBy: null,
});
const o = (n: number, property: string, result: unknown, seq = n * 10): RecordedObservation => ({
  featureId: 't1' as FeatureId,
  property,
  result: result as never,
  seq,
  runId: `r${n}` as RunId,
});
const FILE = { sha256: 'a'.repeat(64), name: 'krone.jpg', mime: 'image/jpeg' };

const RUNS = [
  run(1, 'anna', 'erfassen', 100),
  run(2, 'bert', 'kontrolle', 50),
  run(3, null, 'kontrolle', 30),
  run(4, 'bert', 'kontrolle', 3),
];
const OBS = [
  o(1, '$type', 'baum'),
  o(1, 'stage', 'erfasst'),
  o(1, 'vitalitaet', 'v1'),
  o(1, 'geometrie', { type: 'Point', coordinates: [7, 50] }),
  o(2, 'befund', 'Risse'),
  o(2, 'foto', [FILE]),
  o(3, 'stage', 'massnahme'),
  o(4, 'art', 'unbekannt'),
  o(4, 'befund', 'Rinde ok'),
];
const queued = (n: number, state: 'queued' | 'refused', input: Record<string, unknown>) => ({
  order: n,
  run: {
    id: `r${n}` as RunId,
    task: 'kontrolle' as Key,
    actor: { id: 'anna', kind: 'participant' as const, roles: ['kontrolle' as Key] },
    configVersion: 1,
    featureId: 't1' as FeatureId,
    input: input as never,
    clientTime: NOW,
  },
  blobs: [],
  blobMimes: {},
  state,
});

interface Setup {
  runs?: SyncRun[];
  obs?: RecordedObservation[];
  queue?: ReturnType<typeof queued>[];
  feature?: FeatureState;
  warm?: () => Promise<void>;
}

function setup({ runs = RUNS, obs = OBS, queue = [], feature = tree(), warm }: Setup = {}) {
  const facts: Facts = {
    feature: (id) => (id === feature.id ? feature : undefined),
    near: () => [],
    ofType: () => [],
    edgesFrom: () => [],
    edgesTo: () => [],
    history: () => [],
    observationsByActor: () => [],
    featuresWith: () => [],
    createdBy: () => 0,
  };
  const warmActivity = vi.fn(warm ?? (() => Promise.resolve()));
  const activity: ActivitySource = {
    activityWarm: () => true,
    warmActivity,
    observationsOf: () => [...obs].sort((a, b) => b.seq - a.seq),
    runMeta: (id) => runs.find((r) => r.id === id),
    personName: (id) => ({ bert: 'Bert Muster' })[id],
    queuedRunsOf: () => queue,
    // the fake plan writes what the form said
    plannedChangesOf: (runId, id) =>
      Object.entries(queue.find((q) => q.run.id === runId)?.run.input ?? {}).map(([property, result]) => ({
        featureId: id,
        property,
        result,
      })),
  };
  const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle' as Key] };
  const ids = createDeviceIds({ now: () => NOW }, (n) => new Uint8Array(n));
  const reader = createReader({
    facts,
    versions: { deployed: 1, get: () => config },
    bootstrapVersion: 1,
    actor,
    geo: createGeo(),
    clock: { now: () => NOW },
    ids,
    locale: 'de',
    activity,
    actorName: 'Anna Beispiel',
  });
  const device = {
    reader,
    config,
    actor,
    participant: { id: 'anna', name: 'Anna Beispiel', roles: ['kontrolle'] },
    ids,
    clock: { now: () => NOW },
    submitter: { submit: vi.fn(), outcome: () => () => undefined },
    changed: { subscribe: () => () => undefined, stop: () => undefined },
    // the run notices (WP-647) read the device queue; this spec has none
    store: { readRuns: async () => [] },
    queue: {
      status: () => ({ retryInMs: undefined, sending: undefined }),
      subscribe: () => () => undefined,
      discard: async () => undefined,
      resubmit: async () => ({ ok: true }),
    },
  };
  const view = render(FeatureSheetHost, {
    device: device as never,
    featureId: 't1' as FeatureId,
    locale: 'de',
    open: true,
    onclose: () => undefined,
    onform: () => undefined,
    onopen: () => undefined,
  });
  return { ...view, warmActivity };
}

const entries = () => screen.findAllByTestId('activity-entry');

describe('Aktivität tab', () => {
  it('loads the runs of the feature before the sheet opens', async () => {
    let release: () => void = () => undefined;
    const { warmActivity } = setup({ warm: () => new Promise((r) => (release = r)) });
    expect(warmActivity).toHaveBeenCalledWith('t1');
    expect(screen.queryByRole('tab', { name: 'Aktivität' })).toBeNull();
    release();
    expect(await screen.findByRole('tab', { name: 'Aktivität' })).toBeTruthy();
  });

  it('shows the timeline newest first, grouped by stage visit, with names and the neutral label', async () => {
    setup();
    const stage = await screen.findByTestId('activity-stage');
    expect(stage.textContent).toContain('Verschoben nach: Maßnahme');
    expect(stage.textContent).toContain('Gestern'); // 30 h ago
    const labels = (await entries()).map((r) => r.textContent ?? '');
    // newest first: the last check is on top; "Erstellt" is the oldest
    expect(labels.findIndex((t) => t.includes('2 Felder aktualisiert'))).toBeLessThan(
      labels.findIndex((t) => t.includes('Erstellt')),
    );
  });

  it('names the people as the sync allowed: names, the own name, and "Jemand" for a clipped actor', async () => {
    setup();
    const stage = await screen.findByTestId('activity-stage');
    expect(stage.textContent).toContain('Jemand');
    const rows = await entries();
    const text = rows.map((r) => r.textContent ?? '');
    expect(text[0]).toContain('2 Felder aktualisiert');
    expect(text[0]).toContain('Kontrolle durchführen · Bert Muster');
    expect(text.some((t) => t.includes('Erstellt') && t.includes('Anna Beispiel'))).toBe(true);
  });

  it('the Erstellt header carries the start stage and expands to the values the creating run wrote', async () => {
    setup();
    const rows = await entries();
    const created = rows.find((r) => r.textContent?.includes('Erstellt'));
    expect(created?.textContent).toContain('Erfasst');
    const detail = within(created as HTMLElement).getByTestId('activity-detail');
    expect(detail.textContent).toContain('Vitalität:');
    expect(detail.textContent).toContain('Standort: Standort aktualisiert');
    expect(detail.textContent).not.toContain('Status:'); // the stage write is the header, not a value
  });

  it('shows what a run changed: values, photo thumbnails, and an unresolvable id as a short badge', async () => {
    setup();
    const rows = await entries();
    const second = rows.find((r) => r.textContent?.includes('Risse'));
    expect(second?.textContent).toContain('Foto:');
    expect(second?.querySelector('img, [data-testid]')).not.toBeNull();
    const last = rows[0] as HTMLElement;
    const badge = last.querySelector('[title^="Nicht auflösbare Referenz"]');
    expect(badge?.getAttribute('title')).toBe('Nicht auflösbare Referenz (ID: unbekannt)');
    expect(badge?.textContent?.trim()).toBe('#annt');
  });

  it('shows the status of own runs that are not on the server: pending and refused', async () => {
    setup({
      queue: [queued(5, 'queued', { befund: 'getippt' }), queued(6, 'refused', { stage: 'erledigt' })],
    });
    const badges = await screen.findAllByTestId('activity-run-status');
    expect(badges.map((b) => b.textContent?.trim())).toEqual(['Abgelehnt', 'Wartet auf Übertragung']);
    const rows = (await entries()).map((r) => r.textContent ?? '');
    expect(rows[0]).toContain('Befund aktualisiert'); // one changed value: its label
    // the refused stage move is the top header and carries its own badge
    expect((await screen.findAllByTestId('activity-stage'))[0]?.textContent).toContain('Abgelehnt');
  });

  it('accepted runs show no badge', async () => {
    setup();
    await entries();
    expect(screen.queryAllByTestId('activity-run-status')).toHaveLength(0);
  });

  it('a stage header opens the Daten tab, as v3', async () => {
    setup();
    await userEvent.setup().click(await screen.findByTestId('activity-stage'));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Daten' }).getAttribute('aria-selected')).toBe('true'),
    );
  });

  it('says "Noch keine Aktivität" when the device has no run and no creation time', async () => {
    setup({ runs: [], obs: [] });
    expect(await screen.findByText('Noch keine Aktivität')).toBeTruthy();
  });

  it('falls back to the creation time of the sync row when the creating run is not on the device', async () => {
    setup({
      runs: RUNS.slice(1),
      obs: OBS.filter((x) => x.runId !== 'r1'),
      feature: tree({ createdAt: '2026-09-20T08:00:00.000Z' as Instant, createdBy: 'anna' }),
    });
    const rows = await entries();
    const created = rows.find((r) => r.textContent?.includes('Erstellt'));
    expect(created?.textContent).toContain('Anna Beispiel');
    expect(created?.textContent).toContain('20.9.2026');
  });

  it('has no axe violations', async () => {
    const { baseElement } = setup({ queue: [queued(5, 'queued', { befund: 'getippt' })] });
    await entries();
    const found = (await axe.run(baseElement, { rules: { 'color-contrast': { enabled: false } } }))
      .violations;
    expect(found.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  // WP-710: a run that sets the stage twice (the process start, then a `then: set`) lands in the stage it moved to.
  describe('a run that sets the stage twice', () => {
    const twice = [
      o(1, 'stage', 'erfasst', 11),
      o(1, 'vitalitaet', 'v1', 12),
      o(1, 'stage', 'massnahme', 13),
    ];

    // WP-726 (v3 activity-sections.ts: the initial segment is the stage before the first move): Erstellt in the start
    // stage, then the move the run's `then` made.
    it('a creating run shows Erstellt in the start stage and one move to the stage it ended in', async () => {
      setup({ runs: [run(1, 'anna', 'erfassen', 5)], obs: [o(1, '$type', 'baum', 10), ...twice] });
      const rows = await entries();
      const created = rows.filter((r) => r.textContent?.includes('Erstellt'));
      expect(created).toHaveLength(1);
      expect(created[0]?.textContent).toContain('Erfasst');
      const stages = await screen.findAllByTestId('activity-stage');
      expect(stages).toHaveLength(1);
      expect(stages[0]?.textContent).toContain('Verschoben nach: Maßnahme');
    });

    it('an app create that writes only the start stage shows it once, as Erstellt, without a move', async () => {
      const feature = tree({
        createdAt: new Date(hoursAgo(5)).toISOString() as Instant,
        createdBy: 'anna',
      } as never);
      setup({
        runs: [run(1, 'anna', 'erfassen', 5)],
        obs: [o(1, 'stage', 'erfasst', 11), o(1, 'vitalitaet', 'v1', 12)],
        feature,
      });
      const rows = await entries();
      expect(rows.filter((r) => r.textContent?.includes('Erstellt'))).toHaveLength(1);
      expect(rows.filter((r) => r.textContent?.includes('Erfasst'))).toHaveLength(1);
      expect(screen.queryAllByTestId('activity-stage')).toHaveLength(0);
      expect(screen.queryByText(/Verschoben nach/)).toBeNull();
    });

    it('a non-creating run is one visit in the stage it moved to, and the start stage is not listed again', async () => {
      setup({ runs: [run(1, 'anna', 'erfassen', 5)], obs: twice });
      const stages = await screen.findAllByTestId('activity-stage');
      expect(stages).toHaveLength(1);
      expect(stages[0]?.textContent).toContain('Verschoben nach: Maßnahme');
      expect(screen.queryByText(/Erfasst/)).toBeNull();
    });

    it('with the creation known from the audit fields, the start stage is the Erstellt header and appears once', async () => {
      const feature = tree({ createdAt: NOW, createdBy: 'anna' } as never);
      setup({ runs: [run(1, 'anna', 'erfassen', 5)], obs: twice, feature });
      const stages = await screen.findAllByTestId('activity-stage');
      expect(stages.map((r) => r.textContent ?? '').filter((t) => t.includes('Erfasst'))).toEqual([]);
      const all = [...stages, ...(await entries())].map((r) => r.textContent ?? '');
      expect(all.filter((t) => t.includes('Erfasst'))).toHaveLength(1);
    });
  });
});
