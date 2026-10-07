import { describe, expect, it } from 'vitest';
import { createGeo } from '@ueberblick/core/geo';
import type { Actor, FeatureId, FeatureState, Instant, Key } from '@ueberblick/core/model';
import type { Facts } from '@ueberblick/core/ports';
import { goldenConfig } from '@ueberblick/core/testing';
import type { ConfigVersionResult } from '@ueberblick/client';
import { createDeviceIds } from './ids';
import { createReader, type ActivitySource } from './reader';

const v1 = goldenConfig('templates/baumkataster/1.0.0.yaml');
const v2 = goldenConfig('templates/baumkataster/1.1.0.yaml');
const geo = createGeo();
const at = () => '2026-09-30T10:00:00.000Z' as Instant;
const tree: FeatureState = {
  id: 't1' as FeatureId,
  type: 'baum' as Key,
  properties: { geometrie: { type: 'Point', coordinates: [7.1, 50.7] }, stage: 'erfasst' } as never,
  lifecycle: 'active',
  updatedSeq: 3,
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
const pinned = (version: number): FeatureState => ({ ...tree, version });
const of = (f: FeatureState, held: Record<number, ConfigVersionResult>, deployed = 2) => {
  const facts: Facts = {
    feature: (id) => (id === f.id ? f : undefined),
    near: () => [],
    ofType: () => [],
    edgesFrom: () => [],
    edgesTo: () => [],
    history: () => [],
    observationsByActor: () => [],
    createdBy: () => 0,
    featuresWith: () => [],
  };
  const actor: Actor = { id: 'anna', kind: 'participant', roles: ['kontrolle'] as Key[] };
  return createReader({
    facts,
    versions: { deployed, get: (v) => held[v] ?? 'refetching' },
    bootstrapVersion: 1,
    actor,
    geo,
    clock: { now: at },
    ids: createDeviceIds({ now: at }, (n) => new Uint8Array(n)),
    locale: 'de',
    activity: noActivity,
    actorName: 'Anna Beispiel',
  });
};
const labels = (r: ReturnType<typeof of>) => Object.keys(r.sheetInput(tree.id)?.taskLabels ?? {});

describe('per-version reading (WP-675, A-029)', () => {
  it('a feature pinned to version 1 gets version 1 tasks, a floating one the deployed version 2 tasks', () => {
    const held = { 1: v1, 2: v2 };
    expect(of(pinned(1), held).availableTasks(tree.id)).not.toContain('baum_bearbeiten');
    expect(of(pinned(2), held).availableTasks(tree.id)).toContain('baum_bearbeiten');
    expect(of(tree, held).availableTasks(tree.id)).toContain('baum_bearbeiten');
    expect(labels(of(pinned(1), held))).not.toContain('baum_bearbeiten');
    expect(labels(of(pinned(2), held))).toContain('baum_bearbeiten');
  });

  it('a version not on the device shows the feature read-only, offers no tasks and names what it waits for', () => {
    const r = of(pinned(1), { 2: v2 });
    expect(r.availableTasks(tree.id)).toEqual([]);
    const input = r.sheetInput(tree.id);
    expect(input?.availableTasks).toEqual([]);
    expect(input?.feature.id).toBe(tree.id);
    expect(r.awaitingVersion(tree.id)).toBe(1);
    expect(of(pinned(1), { 1: v1, 2: v2 }).awaitingVersion(tree.id)).toBeUndefined();
  });

  it('starting a task with no feature uses the deployed version', () => {
    expect(of(tree, { 1: v1, 2: v2 }).startableTasks()).toContain('erfassen');
  });
});
