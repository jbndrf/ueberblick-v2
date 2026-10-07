import { describe, expect, it } from 'vitest';
import { createRng } from '@ueberblick/core/testing';
import { Faults, NetworkFault, NO_FAULTS, type Link } from './net.testing';

const run = async (seed: number, calls: number): Promise<string[]> => {
  const tick = { n: 0 };
  const faults = new Faults(createRng(seed), { drop: 0.3, duplicate: 0.4, maxDelay: 3 }, () => tick.n);
  const link: Link = { online: true };
  const seen: string[] = [];
  for (let i = 0; i < calls; i++) {
    tick.n = i;
    try {
      await faults.call(link, () => Promise.resolve(seen.push(`send ${i}`)), true);
      seen.push(`ok ${i}`);
    } catch (e) {
      seen.push(`${(e as Error).message} ${i}`);
    }
    await faults.deliverLate();
  }
  return seen;
};

describe('seeded faults', () => {
  it('are a pure function of the seed', async () => {
    expect(await run(5, 60)).toEqual(await run(5, 60));
    expect(await run(5, 60)).not.toEqual(await run(6, 60));
  });

  it('lose requests before the server, lose replies after it, and duplicate', async () => {
    const seen = await run(9, 200);
    expect(seen.some((s) => s.startsWith('request lost'))).toBe(true);
    expect(seen.some((s) => s.startsWith('reply lost'))).toBe(true);
    const sends = seen.filter((s) => s.startsWith('send')).length;
    const lostReplies = seen.filter((s) => s.startsWith('reply lost')).length;
    expect(sends).toBeGreaterThan(seen.filter((s) => s.startsWith('ok')).length + lostReplies - 1); // duplicates add sends
  });

  it('an offline link fails before anything leaves the device', async () => {
    const faults = new Faults(createRng(1), NO_FAULTS, () => 0);
    let reached = 0;
    await expect(
      faults.call({ online: false }, () => Promise.resolve(++reached), true),
    ).rejects.toBeInstanceOf(NetworkFault);
    expect(reached).toBe(0);
  });

  it('a late duplicate reaches the server after its due tick, and all of them when the network heals', async () => {
    const tick = { n: 0 };
    const faults = new Faults(createRng(3), { drop: 0, duplicate: 1, maxDelay: 5 }, () => tick.n);
    const arrivals: number[] = [];
    for (let i = 0; i < 20; i++) {
      tick.n = i;
      await faults.call({ online: true }, () => Promise.resolve(arrivals.push(i)), true);
    }
    expect(faults.stats.lateDuplicates).toBeGreaterThan(0);
    const before = arrivals.length;
    await faults.deliverLate(true);
    expect(arrivals.length).toBe(before + faults.stats.lateDuplicates);
    await faults.deliverLate(true);
    expect(arrivals.length).toBe(before + faults.stats.lateDuplicates); // each is delivered once
  });
});
