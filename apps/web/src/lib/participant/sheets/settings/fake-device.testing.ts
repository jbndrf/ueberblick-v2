/** A scripted device slice for the Einstellungen specs: queue, sync worker, clock; every call is recorded. */
import { vi } from 'vitest';
import type { QueueStatus, StoredRun, SyncStatus } from '@ueberblick/client';
import type { FeatureId, Key, Refusal, RunId } from '@ueberblick/core/model';
import { deviceClone } from '../../../../../../../packages/client/src/testing/clone.testing';
import type { AppProblem } from '../../notices';
import type { SettingsDevice } from './device';

export const queueStatus = (over: Partial<QueueStatus> = {}): QueueStatus => ({
  pending: 0,
  awaitingPull: 0,
  oldestPendingAgeMs: undefined,
  sending: undefined,
  refused: [],
  review: [],
  hold: undefined,
  awaitingConfig: [],
  retryInMs: undefined,
  serverProtocol: undefined,
  unpredicted: [],
  ...over,
});

export const syncStatus = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  phase: 'idle',
  lastSyncedAt: undefined,
  lastSyncedSeq: undefined,
  lastError: undefined,
  featuresLoaded: 0,
  ...over,
});

export function storedRun(
  id: string,
  order: number,
  state: StoredRun['state'],
  opts: { featureId?: string; refusal?: Refusal; task?: string; group?: string } = {},
): StoredRun {
  return {
    order,
    blobs: [],
    blobMimes: {},
    state,
    ...(opts.group === undefined ? {} : { group: opts.group }),
    ...(opts.refusal === undefined ? {} : { refusal: opts.refusal }),
    run: {
      id: id as RunId,
      task: (opts.task ?? 'inspect') as Key,
      actor: { id: 'p1', kind: 'participant', roles: [] },
      configVersion: 1,
      ...(opts.featureId === undefined ? {} : { featureId: opts.featureId as FeatureId }),
      input: {},
    },
  };
}

export function fakeDevice(
  runs: StoredRun[],
  sync: SyncStatus = syncStatus(),
  identity: Partial<SettingsDevice['identity']> = {},
  email: string | null = null,
  problems: readonly AppProblem[] = [],
  /** Which Objekte this device holds (default: all). */
  onDevice: (featureId: string) => boolean = () => true,
) {
  const listeners = new Set<(s: QueueStatus) => void>();
  const changedListeners = new Set<(c: 'all') => void>();
  const calls = { discard: vi.fn(), resubmit: vi.fn(), syncNow: vi.fn() };
  const device: SettingsDevice = {
    participant: { id: 'anna', name: 'Anna', roles: ['pruefer'], email, phone: null },
    identity: { login: null, infoPages: [], legalPages: [], ...identity },
    clock: { now: () => '2026-10-01T12:00:00Z' },
    queue: {
      status: () => queueStatus({ pending: runs.filter((r) => r.state === 'queued').length }),
      subscribe: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      discard: async (id) => {
        calls.discard(id);
        const at = runs.findIndex((r) => r.run.id === id);
        if (at >= 0) runs.splice(at, 1);
        for (const l of listeners) l(queueStatus());
      },
      resubmit: async (id) => {
        calls.resubmit(id);
        return { ok: true, orders: [1], created: {} };
      },
    },
    changed: {
      subscribe: (l) => {
        changedListeners.add(l);
        return () => changedListeners.delete(l);
      },
    },
    store: {
      readRuns: async () => deviceClone(runs),
      facts: { feature: (id) => (onDevice(id) ? {} : undefined) },
    },
    problems: { list: () => problems, subscribe: () => () => undefined },
    sync: {
      syncNow: async () => void (await calls.syncNow()),
      worker: { status: () => sync, subscribe: () => () => undefined },
    },
  };
  return { device, calls, ringChanged: () => changedListeners.forEach((l) => l('all')) };
}

/** An in-memory `localStorage`. */
export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}
