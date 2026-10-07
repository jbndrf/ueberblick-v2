/**
 * Budget (WP-211): `propose` (open the draft, apply ops, compile, diff, problems) on the largest golden
 * project <= 200 ms (median). Cold path: one call per assistant proposal.
 * Run: npm run bench:test -- bench/builder-mcp
 */
import { describe, expect, it } from 'vitest';
import { assertBudget, defineBudget, report } from '../harness/budget.mjs';
import { createMcpServer } from '../../packages/builder/src/mcp';
import { largest } from '../../packages/builder/src/testing/golden';

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number;

describe('builder MCP: propose', () => {
  it('propose on the largest golden project in <= 200 ms (median)', async () => {
    const server = createMcpServer({
      project: 'bench',
      draft: {
        read: () =>
          Promise.resolve({
            ok: true,
            draft: { templateSrc: largest.templateSrc, overlaySrc: largest.overlaySrc, revision: 1 },
          }),
        write: () => Promise.resolve({ ok: false, code: 'write_refused', status: 500, message: 'read-only' }),
      },
      confirmation: { sign: () => '', now: () => 0, ttlMs: 1 },
    });
    const labelOp = { kind: 'set', path: 'tasks.kontrolle.label', value: { de: 'Neu', en: 'New' } };
    const message = (id: number) => ({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name: 'propose', arguments: { ops: [labelOp] } },
    });
    const once = async (id: number) => {
      const t = performance.now();
      const res = await server.handle(message(id));
      const ms = performance.now() - t;
      expect(res).not.toBeNull();
      return ms;
    };
    await once(0); // warm up
    const samples: number[] = [];
    for (let i = 1; i <= 20; i++) samples.push(await once(i));
    const ms = median(samples);
    console.info(`builder-mcp propose: ${ms.toFixed(2)} ms median (${largest.name})`);
    assertBudget(
      report(
        defineBudget({
          id: 'builder-mcp-propose',
          limit: 200,
          unit: 'ms',
          derivedFrom:
            'an assistant waits on a proposal before it answers; 200 ms keeps it well below a model round trip',
          device: 'dev-only',
          thread: 'main',
        }),
        Number(ms.toFixed(2)),
      ),
    );
  });
});
