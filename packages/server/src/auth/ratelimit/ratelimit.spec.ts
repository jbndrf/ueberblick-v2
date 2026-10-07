import { describe, expect, it } from 'vitest';
import { createMemoryRateLimiter } from './memory';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}
const cfg = { maxFailures: 3, windowMs: 60_000 };

describe('memory rate limiter', () => {
  it('allows until maxFailures failures within the window, then refuses with Retry-After', () => {
    const c = clock();
    const rl = createMemoryRateLimiter({ ...cfg, now: c.now });
    for (let i = 0; i < 3; i++) {
      expect(rl.check('k')).toEqual({ ok: true });
      rl.fail('k');
      c.advance(1000);
    }
    const r = rl.check('k');
    expect(r.ok).toBe(false);
    // oldest failure was 3 s ago, window 60 s
    if (!r.ok) expect(r.retryAfterSeconds).toBe(57);
  });

  it('frees the key when the oldest failure leaves the window', () => {
    const c = clock();
    const rl = createMemoryRateLimiter({ ...cfg, now: c.now });
    for (let i = 0; i < 3; i++) rl.fail('k');
    expect(rl.check('k').ok).toBe(false);
    c.advance(60_000);
    expect(rl.check('k')).toEqual({ ok: true });
  });

  it('a success (reset) clears the key; other keys are independent', () => {
    const c = clock();
    const rl = createMemoryRateLimiter({ ...cfg, now: c.now });
    for (let i = 0; i < 3; i++) rl.fail('a');
    expect(rl.check('b')).toEqual({ ok: true });
    rl.reset('a');
    expect(rl.check('a')).toEqual({ ok: true });
  });

  it('bounds memory: at most maxKeys keys are tracked', () => {
    const c = clock();
    const rl = createMemoryRateLimiter({ ...cfg, now: c.now, maxKeys: 10 });
    for (let i = 0; i < 1000; i++) rl.fail(`k${i}`);
    expect(rl.size()).toBeLessThanOrEqual(10);
  });

  it('property: refusal happens exactly when >= maxFailures failures fall inside the window', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 200; run++) {
      const c = clock(0);
      const rl = createMemoryRateLimiter({ ...cfg, now: c.now });
      const fails: number[] = [];
      for (let step = 0; step < 30; step++) {
        c.advance(Math.floor(rnd() * 30_000));
        const now = c.now().getTime();
        const inWindow = fails.filter((f) => f > now - cfg.windowMs).length;
        expect(rl.check('k').ok).toBe(inWindow < cfg.maxFailures);
        if (rnd() < 0.6) {
          rl.fail('k');
          fails.push(now);
        }
      }
    }
  });
});
