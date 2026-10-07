/** Test helpers: a fresh fake IndexedDB per test, an in-memory marker, page builders. Tests only. */
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { vi } from 'vitest';
import type { Edge, FeatureId, FeatureState, Key, RunId } from '@ueberblick/core/model';
import type { SyncEdge, SyncObservation, SyncRun } from '@ueberblick/core/sync';
import type { EvictionMarker, PageRows, StoredCursor } from './contract';
import type { IdbEnv, IdbFactory, IdbKeyRangeStatic } from './idb-types';

export type FakeFactory = InstanceType<typeof IDBFactory>;
export const newFactory = (): FakeFactory => new IDBFactory();

/** The fake's object-store prototype, for spies that inject faults or count scans. */
export type StoreProto = Record<string, (this: { readonly name: string }, ...args: unknown[]) => unknown>;
export const storeProto = IDBObjectStore.prototype as unknown as StoreProto;

export function fakeEnv(factory: FakeFactory = newFactory()): IdbEnv {
  return {
    factory: factory as unknown as IdbFactory,
    keyRange: IDBKeyRange as unknown as IdbKeyRangeStatic,
  };
}

export function memoryMarker(initial = false): EvictionMarker & { value: boolean } {
  const m = {
    value: initial,
    isInitialised: () => m.value,
    markInitialised: () => {
      m.value = true;
    },
  };
  return m;
}

export const fid = (n: number): FeatureId =>
  `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}` as FeatureId;
export const rid = (n: number): RunId => `018f0000-0000-7000-9000-${String(n).padStart(12, '0')}` as RunId;
export const key = (s: string): Key => s as Key;

export function feature(n: number, seq: number, extra: Record<string, unknown> = {}): FeatureState {
  return {
    id: fid(n),
    type: key('tree'),
    properties: {
      geometry: { type: 'Point', coordinates: [13 + n / 1e4, 52, 30 + n] },
      height_m: seq,
      ...extra,
    } as FeatureState['properties'],
    lifecycle: 'active',
    updatedSeq: seq,
  };
}

export function edge(from: number, relation: string, to: number, seq: number): SyncEdge {
  return { from: fid(from), relation: key(relation), to: fid(to), derived: false, updatedSeq: seq };
}

export function obs(n: number, property: string, seq: number, result: unknown = seq): SyncObservation {
  return {
    featureId: fid(n),
    property,
    result: result as SyncObservation['result'],
    phenomenonTime: null,
    resultTime: null,
    seq,
    runId: rid(seq),
  };
}

/** The run row of `obs(.., seq)`: run id `rid(seq)`. */
export function syncRun(seq: number, actor: string | null = 'p1', task = 'kontrolle'): SyncRun {
  return { id: rid(seq), task, actor, clientTime: 1_000 + seq, receivedAt: 2_000 + seq, seq, causedBy: null };
}

export function rows(partial: Partial<PageRows>): PageRows {
  return { features: [], edges: [], observations: [], tombstones: [], runs: [], people: [], ...partial };
}

export function cursorAt(cursor: number, kind: StoredCursor['kind'] = 'snapshot'): StoredCursor {
  return { kind, cursor, scopeFingerprint: 'scope-a' };
}

export const plainEdge = (e: SyncEdge): Edge => ({
  from: e.from,
  relation: e.relation,
  to: e.to,
  derived: e.derived,
});

/** Wraps a fake object-store method; `around` may call `next` or throw to inject a fault. Restore with vi.restoreAllMocks. */
export function wrapStore(
  method: string,
  around: (next: () => unknown, self: { readonly name: string }, args: readonly unknown[]) => unknown,
): void {
  const real = storeProto[method];
  if (!real) throw new Error(`no such method ${method}`);
  vi.spyOn(storeProto, method).mockImplementation(function (
    this: { readonly name: string },
    ...args: unknown[]
  ) {
    return around(() => real.apply(this, args), this, args);
  });
}

/** Tests: the queue no longer holds any run (settled or removed) while its blob bytes stay, as after a settled upload. */
export function unqueueRuns(env: IdbEnv, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = env.factory.open(name);
    open.onerror = () => reject(open.error ?? new Error('open failed'));
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(['runs'], 'readwrite');
      tx.objectStore('runs').clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('clear failed'));
    };
  });
}
