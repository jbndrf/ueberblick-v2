/** Test helpers for the live-version keeping specs (WP-669). Tests only. */
import { serialize } from '@ueberblick/core/hydrate';
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import { musterstadt } from '../queue/world.testing';
import type { ConfigFetcher } from './contract';

/** The compiled form of the Musterstadt world, as the server would send it (JSON round trip). */
export function compiledWorld(): CompiledConfigData {
  return JSON.parse(JSON.stringify(serialize(musterstadt().config))) as CompiledConfigData;
}

export interface CountingFetcher extends ConfigFetcher {
  readonly calls: number[];
  /** While true every fetch fails like an offline device. */
  offline: boolean;
}

export function countingFetcher(): CountingFetcher {
  const data = compiledWorld();
  const f: CountingFetcher = {
    calls: [],
    offline: false,
    fetchCompiled(version) {
      f.calls.push(version);
      return f.offline ? Promise.reject(new Error('offline')) : Promise.resolve(data);
    },
  };
  return f;
}
