/**
 * The confirmed state of a device store as one canonical string, and a fresh device's pull of the same actor
 * (the oracle): a device that followed the server through deltas must equal one that took a snapshot.
 */
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Actor, FeatureId, FeatureState } from '@ueberblick/core/model';
import { createClock } from '@ueberblick/core/testing';
import type { DeviceStore } from '../store';
import { openDeviceStore } from '../store/open';
import { fakeEnv, memoryMarker } from '../store/test-env';
import { createSyncWorker, decodingTransport, inlineDecoder } from '../sync';
import { memoryMeta } from '../sync/test-server';
import type { SimBackend } from './contract.testing';

export interface StoreDump {
  readonly features: readonly FeatureState[];
  readonly edges: readonly string[];
  /** The store cursor: the seq the device is current up to. */
  readonly cursor: number | undefined;
}

const byId = (a: { readonly id: string }, b: { readonly id: string }): number => (a.id < b.id ? -1 : 1);

/** Only meaningful with an empty run queue: predictions overlay the confirmed state until they are dropped. */
export function dumpStore(store: DeviceStore, config: CompiledConfig): StoreDump {
  const features: FeatureState[] = [];
  const edges: string[] = [];
  for (const type of config.foldTypes.keys()) {
    for (const id of store.featureIdsOfType(type)) {
      const f = store.facts.feature(id as FeatureId);
      if (f === undefined) continue;
      features.push(f);
      for (const e of store.facts.edgesFrom(f.id)) edges.push(`${e.from}|${e.relation}|${e.to}|${e.derived}`);
    }
  }
  return { features: features.sort(byId), edges: edges.sort(), cursor: store.cursor()?.cursor };
}

/** A fresh device of `actor` takes a snapshot with the real sync worker over a fault-free transport. */
export async function freshDump(
  backend: SimBackend,
  actor: Actor,
  maxRows: number,
  start: string,
): Promise<StoreDump> {
  const store = await openDeviceStore(`oracle-${actor.id}`, { env: fakeEnv(), marker: memoryMarker() });
  try {
    const worker = createSyncWorker({
      store,
      transport: decodingTransport(backend.syncTransport(actor), inlineDecoder, maxRows),
      meta: memoryMeta(),
      predictions: { rederive: () => Promise.resolve() },
      clock: createClock(start),
    });
    await worker.pull();
    return dumpStore(store, backend.config);
  } finally {
    store.close();
  }
}
