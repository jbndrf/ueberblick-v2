import { describe, expect, it } from 'vitest';
import type { SyncVersions } from '@ueberblick/core/sync';
import type { VersionsSink } from './contract';
import { lateVersionsSink } from './sink';

function recorder() {
  const calls: string[] = [];
  const sink: VersionsSink = {
    follow: (v) => void calls.push(`follow ${v.live.join(',')}`),
    synced: (v) => (calls.push(`synced ${v.live.join(',')}`), Promise.resolve()),
  };
  return { calls, sink };
}

const v = (...live: number[]): SyncVersions => ({ deployed: live[0] as number, live });

describe('lateVersionsSink', () => {
  it('replays the last follow and the last synced, in that order, on bind', async () => {
    const late = lateVersionsSink();
    late.follow(v(1));
    late.follow(v(1, 2)); // a follower tab is relayed headers before the device exists
    await late.synced(v(1, 2));
    const { calls, sink } = recorder();
    late.bind(sink);
    expect(calls).toEqual(['follow 1,2', 'synced 1,2']);
  });

  it('replays only what arrived, and forwards directly after bind', async () => {
    const late = lateVersionsSink();
    const { calls, sink } = recorder();
    late.follow(v(3));
    late.bind(sink);
    expect(calls).toEqual(['follow 3']);
    late.follow(v(4));
    await late.synced(v(4));
    expect(calls).toEqual(['follow 3', 'follow 4', 'synced 4']);
    late.bind(sink); // nothing left to replay
    expect(calls).toHaveLength(3);
  });
});
