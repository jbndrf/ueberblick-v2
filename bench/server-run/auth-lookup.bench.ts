/**
 * Budget (WP-104; the removed unit assert): one session lookup (`authenticate`, one indexed read) <= 1 ms on average
 * over 2,000 lookups. It sits inside every request, so it counts against the run endpoint p95. Moved from the unit
 * spec (WP-147). Run: npm test -- -c bench/vitest.config.ts bench/server-run
 */
import { describe, expect, it } from 'vitest';
import type { Key } from '../../packages/core/src';
import { createAuth, isAuthError } from '../../packages/server/src/auth';
import { openControlDb } from '../../packages/server/src/db/open';
import { defineBudget, report } from '../harness/budget.mjs';

describe('bench: session lookup', () => {
  it('authenticate averages <= 1 ms over 2,000 lookups', () => {
    const db = openControlDb(':memory:');
    db.prepare('INSERT INTO projects (id, key, name, created_at) VALUES (?,?,?,?)').run(
      'p1',
      'trees',
      'Trees',
      'x',
    );
    const auth = createAuth({
      control: db,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
      participantRoles: () => ['kontrolleur' as Key],
    });
    const s = auth.exchange(auth.issueCredential('p1', 'u1').token);
    if (isAuthError(s)) throw new Error(s.code);
    auth.authenticate(s.id);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) auth.authenticate(s.id);
    const ms = (performance.now() - t0) / 2000;
    expect(auth.authenticate(s.id)).toBeTruthy();
    console.info(`auth lookup: ${(ms * 1000).toFixed(1)} us`);
    report(
      defineBudget({
        id: 'server-auth-lookup',
        limit: 1,
        unit: 'ms',
        derivedFrom:
          'run-endpoint-p95: the session lookup is part of every request; limit of the removed unit assert',
        device: 'server',
      }),
      Number(ms.toFixed(4)),
    );
  });
});
