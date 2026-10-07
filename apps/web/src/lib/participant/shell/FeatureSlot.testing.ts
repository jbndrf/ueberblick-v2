// Shared setup of the feature-slot specs (WP-783: split out of FeatureSlot.ui.spec.ts for the 400-line limit).
import { render } from '@testing-library/svelte';
import { vi } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { goldenConfig } from '@ueberblick/core/testing';
import { createDeviceIds } from '../ids';
import { createFilterController } from '../sheets/filter/filter-controller';
import { createReader, type ActivitySource } from '../reader';
import { createChatLink } from '../tools/chat-link';
import FeatureSlot from './FeatureSlot.svelte';

export const config = goldenConfig('templates/baumkataster/1.1.0.yaml');
export const at = () => '2026-10-01T12:00:00Z' as Instant;
export const tree: FeatureState = {
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  properties: {
    stage: 'massnahme',
    beschreibung: { de: 'Alte Eiche' },
    geometrie: { type: 'Point', coordinates: [7.05, 50.05] },
  } as never,
  lifecycle: 'active',
  updatedSeq: 3,
};
export const area: FeatureState = {
  id: 'a1' as FeatureId,
  type: 'flaeche' as Key,
  properties: {
    name: 'Park',
    geometrie: {
      type: 'Polygon',
      coordinates: [
        [
          [7.1, 50.1],
          [7.11, 50.1],
          [7.11, 50.11],
          [7.1, 50.1],
        ],
      ],
    },
  } as never,
  lifecycle: 'active',
  updatedSeq: 3,
};
export const facts: Facts = {
  feature: (id) => [tree, area].find((f) => f.id === id),
  near: () => [],
  ofType: () => [],
  edgesFrom: () => [],
  edgesTo: () => [],
  history: () => [],
  observationsByActor: () => [],
  featuresWith: () => [],
  createdBy: () => 0,
};
export const noActivity: ActivitySource = {
  activityWarm: () => false,
  warmActivity: () => Promise.resolve(),
  observationsOf: () => [],
  runMeta: () => undefined,
  personName: () => undefined,
  queuedRunsOf: () => [],
  plannedChangesOf: () => [],
};

export function fakeMap() {
  const markers = new Map<string, [number, number]>();
  const taps = new Set<(p: [number, number]) => void>();
  return {
    taps,
    markers,
    extent: () => [7, 50, 7.2, 50.2],
    centerOn: () => {},
    onExtentChange: () => () => {},
    onMove: () => () => {},
    onMapTap: (f: (p: [number, number]) => void) => (taps.add(f), () => taps.delete(f)),
    onMarkerDrag: () => () => {},
    addMarker: (id: string, p: [number, number]) => markers.set(id, p),
    moveMarker: (id: string, p: [number, number]) => markers.set(id, p),
    markerPosition: (id: string) => markers.get(id),
    removeMarker: (id: string) => markers.delete(id),
    showOverlay: () => {},
    clearOverlay: () => {},
    unproject: () => [7.1, 50.1],
    project: () => ({ x: 0, y: 0 }),
    setDoubleClickZoom: () => {},
  };
}

export function setup(
  cfg: typeof config = config,
  opts: {
    feature?: FeatureState;
    roles?: string[];
    refuse?: string;
    chatOn?: boolean;
    createdBy?: readonly string[];
    accept?: boolean;
    /** The Liste stands in for the map: `ctx.map` is none until `showMap` is called. */
    listShown?: boolean;
  } = {},
) {
  const actor: Actor = { id: 'anna', kind: 'participant', roles: (opts.roles ?? ['kontrolle']) as Key[] };
  const ids = createDeviceIds({ now: at }, (n) => new Uint8Array(n));
  const geo = createGeo();
  const known =
    opts.feature === undefined
      ? facts
      : {
          ...facts,
          feature: (id: FeatureId) => [tree, area, opts.feature as FeatureState].find((f) => f.id === id),
        };
  const reader = createReader({
    facts: known,
    versions: { deployed: 1, get: () => cfg },
    bootstrapVersion: 1,
    actor,
    geo,
    clock: { now: at },
    ids,
    locale: 'de',
    activity: noActivity,
    actorName: 'Anna',
  });
  const chat = createChatLink();
  const device = {
    chat,
    reader,
    config: cfg,
    classified: cfg,
    actor,
    roleKey: 'kontrolle',
    geo,
    blobs: {},
    ids,
    clock: { now: at },
    store: { featureIdsOfType: () => [], readRuns: async () => [] },
    feature: (id: FeatureId) => known.feature(id),
    submitter: {
      submit: vi.fn<(run: unknown) => Promise<'queued'>>(async () => 'queued'),
      outcome: (_id: string, listener: (p: unknown) => void) => {
        if (opts.refuse !== undefined) listener({ state: 'refused', reason: opts.refuse });
        if (opts.accept === true) setTimeout(() => listener({ state: 'accepted' }), 20);
        return () => undefined;
      },
    },
    drafts: { get: async () => undefined, put: async () => undefined, drop: async () => undefined },
    changed: { subscribe: () => () => undefined, stop: () => undefined },
    // the run notices (WP-647) read the device queue; this spec has none
    queue: {
      createdBy: () => opts.createdBy ?? [],
      status: () => ({ retryInMs: undefined, sending: undefined }),
      subscribe: () => () => undefined,
      discard: async () => undefined,
      resubmit: async () => ({ ok: true }),
    },
  };
  const onclose = vi.fn();
  const setPlacing = vi.fn();
  const map = fakeMap();
  const centerOn = vi.spyOn(map, 'centerOn');
  let listShown = opts.listShown === true;
  const ctxOf = () => ({
    device,
    locale: 'de',
    online: true,
    map: listShown ? undefined : map,
    listShown,
    showMap: () => {
      listShown = false;
      void view.rerender({ ctx: ctxOf() as never });
    },
    center: () => undefined,
    openFeature: vi.fn(),
    filter: createFilterController(),
    setPlacing,
    tools: { entries: opts.chatOn ? [{ key: 'chat', availability: 'active', on: true }] : [] },
  });
  const ctx = ctxOf();
  const view = render(FeatureSlot, { ctx: ctx as never, onclose, featureId: (opts.feature ?? tree).id });
  return {
    onclose,
    setPlacing,
    chat,
    map,
    centerOn,
    submit: device.submitter.submit,
    openFeature: ctx.openFeature,
    showMap: ctx.showMap,
  };
}
