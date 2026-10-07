import { describe, expect, it } from 'vitest';
import { createHostLimiter } from './limiter';

/** A virtual clock: `sleep` advances time, so the test never waits. */
function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      const target = t + ms;
      await Promise.resolve();
      t = Math.max(t, target);
    },
  };
}

describe('host limiter', () => {
  it('never runs more than `concurrency` requests of one host at once', async () => {
    const limiter = createHostLimiter({ concurrency: 2, perSecond: 1000, ...clock() });
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        limiter.run('a', async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 2));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it('spaces the starts of one host by 1/perSecond, and leaves other hosts alone', async () => {
    const waits: number[] = [];
    const limiter = createHostLimiter({
      concurrency: 10,
      perSecond: 4,
      now: () => 0,
      sleep: async (ms) => void waits.push(ms),
    });
    await Promise.all(Array.from({ length: 4 }, () => limiter.run('a', async () => undefined)));
    expect(waits).toEqual([250, 500, 750]); // the first starts at once, each next one 250 ms later
    await limiter.run('b', async () => undefined);
    expect(waits).toHaveLength(3); // b has its own budget and starts at once
  });

  it('penalize holds back the next start', async () => {
    const c = clock();
    const limiter = createHostLimiter({ concurrency: 1, perSecond: 1000, ...c });
    limiter.penalize('a', 3000);
    let at = -1;
    await limiter.run('a', async () => void (at = c.now()));
    expect(at).toBe(3000);
  });

  it('runs a request even when an earlier one threw', async () => {
    const limiter = createHostLimiter({ concurrency: 1, perSecond: 1000, ...clock() });
    await expect(limiter.run('a', () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await limiter.run('a', async () => 7)).toBe(7);
  });
});
