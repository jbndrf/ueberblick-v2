/**
 * Budget (WP-108; the removed unit assert): a committed run rings the sync doorbell (event `seq`) within 100 ms,
 * measured in process through the HTTP handler (median of 15). It is the server part of docs/12 "Delta visible after a
 * server change" (<= 1 s). Moved from the unit spec (WP-147).
 * Run: npm test -- -c bench/vitest.config.ts bench/server-sync
 */
import { describe, expect, it } from 'vitest';
import { anna, IDS, setupHttp } from '../../packages/server/src/http/sync/testkit';
import { defineBudget, report } from '../harness/budget.mjs';

describe('bench: sync doorbell', () => {
  it('a committed run rings the doorbell in <= 100 ms (median of 15)', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 15; i++) {
      const h = setupHttp();
      const abort = new AbortController();
      const res = h.handlers.events({
        request: new Request('http://x/api/p/demo/sync/events', { signal: abort.signal }),
        project: 'demo',
        principal: h.anna,
      });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toContain('event: hello');
      const t0 = performance.now();
      const result = h.store.submit(
        h.ctx.run('kontrolle', anna, { vitalitaet: 'v3', befund: 'Bell' }, IDS.t_in),
      );
      const msg = decoder.decode((await reader.read()).value);
      samples.push(performance.now() - t0);
      expect(result.outcome).toBe('accepted');
      expect(msg.startsWith('event: seq')).toBe(true);
      abort.abort();
    }
    samples.sort((a, b) => a - b);
    const median = samples[7] as number;
    console.info(`sync doorbell: ${median.toFixed(2)} ms median`);
    report(
      defineBudget({
        id: 'server-sync-doorbell',
        limit: 100,
        unit: 'ms',
        derivedFrom: 'delta-visible: the server share of the 1 s delta; limit of the removed unit assert',
        device: 'server',
      }),
      Number(median.toFixed(2)),
    );
  });
});
