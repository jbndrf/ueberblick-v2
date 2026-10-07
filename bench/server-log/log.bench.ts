import { describe, it } from 'vitest';
import { defineBudget, report } from '../harness/budget.mjs';
import { createLogger } from '../../packages/server/src/log';
import { logHttpAccess } from '../../packages/server/src/http/shared/observe';

describe('bench server-log (WP-537)', () => {
  it('logger overhead per call', () => {
    const logger = createLogger({ sink: () => undefined, now: () => 1 });
    const times: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const t = performance.now();
      logger.log('run.committed', { runId: 'r', actor: 'a', observations: 3, ms: 2 });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
    report(
      defineBudget({
        id: 'server-log-call-p95',
        limit: 0.1,
        unit: 'ms',
        derivedFrom: 'run-endpoint-p95: one log call on the run path may cost at most 0.1 ms (WP-537)',
        device: 'server',
      }),
      Number(p95.toFixed(4)),
    );
  });

  it('http.access line per request', () => {
    const logger = createLogger({ sink: () => undefined, now: () => 1 });
    const times: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const t = performance.now();
      logHttpAccess(logger, {
        method: 'GET',
        route: '/api/p/[project]/sync',
        status: 200,
        ip: '203.0.113.77',
        ms: 2,
      });
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)] ?? 0;
    report(
      defineBudget({
        id: 'server-log-call-p95',
        limit: 0.1,
        unit: 'ms',
        derivedFrom: 'one http.access emit per request may cost at most the log-call budget (WP-1043)',
        device: 'server',
      }),
      Number(p95.toFixed(4)),
    );
  });
});
