import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Clock } from '@ueberblick/core';
import { openProjectDb } from '../db/open';
import type { Db } from '../db/driver';
import { defineEffect, effectRegistry, runOutbox, webhookEffect } from './index';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');
function fakeClock(): Clock & { advance(ms: number): void } {
  let t = T0;
  return { now: () => new Date(t).toISOString(), advance: (ms) => void (t += ms) };
}
const enqueue = (db: Db, kind: string, payload: unknown = {}, runId = 'r1'): void => {
  db.prepare('INSERT INTO outbox (run_id, kind, payload) VALUES (?, ?, ?)').run(
    runId,
    kind,
    JSON.stringify(payload),
  );
};
const row = (db: Db) => {
  const r = db
    .prepare<{ attempts: number; next_at: string | null; done_at: string | null }>('SELECT * FROM outbox')
    .get();
  if (!r) throw new Error('no outbox row');
  return r;
};

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('outbox worker', () => {
  it('retries with exponential backoff, marks done, never repeats a success', async () => {
    const db = openProjectDb(':memory:', 'p');
    const clock = fakeClock();
    const calls: number[] = [];
    let failuresLeft = 3;
    const effects = effectRegistry([
      defineEffect({
        key: 'test',
        description: 'fails three times',
        handler: async (_p, ctx) => {
          calls.push(ctx.attempt);
          if (failuresLeft-- > 0) throw new Error('boom');
        },
      }),
    ]);
    enqueue(db, 'test');
    const run = () => runOutbox({ db, effects, clock, baseDelayMs: 1000 });

    expect(await run()).toEqual({ done: 0, failed: 1 });
    expect(row(db).next_at).toBe(new Date(T0 + 1000).toISOString());
    expect(await run()).toEqual({ done: 0, failed: 0 }); // not due yet
    clock.advance(999);
    expect(await run()).toEqual({ done: 0, failed: 0 });
    clock.advance(1);
    expect(await run()).toEqual({ done: 0, failed: 1 }); // attempt 2, delay 2000
    clock.advance(1999);
    expect(await run()).toEqual({ done: 0, failed: 0 });
    clock.advance(1);
    expect(await run()).toEqual({ done: 0, failed: 1 }); // attempt 3, delay 4000
    clock.advance(4000);
    expect(await run()).toEqual({ done: 1, failed: 0 }); // attempt 4 succeeds
    expect(row(db).done_at).not.toBeNull();

    clock.advance(10_000_000);
    expect(await run()).toEqual({ done: 0, failed: 0 });
    expect(calls).toEqual([1, 2, 3, 4]);
  });

  it('stops after maxAttempts', async () => {
    const db = openProjectDb(':memory:', 'p');
    const clock = fakeClock();
    let n = 0;
    const effects = effectRegistry([
      defineEffect({
        key: 'bad',
        description: 'always fails',
        handler: async () => {
          n++;
          throw new Error('x');
        },
      }),
    ]);
    enqueue(db, 'bad');
    for (let i = 0; i < 6; i++) {
      await runOutbox({ db, effects, clock, maxAttempts: 3, baseDelayMs: 10 });
      clock.advance(1000);
    }
    expect(n).toBe(3);
    expect(row(db).done_at).toBeNull();
  });

  it('treats an unknown kind as a failure', async () => {
    const db = openProjectDb(':memory:', 'p');
    enqueue(db, 'nope');
    const r = await runOutbox({ db, effects: effectRegistry([]), clock: fakeClock() });
    expect(r).toEqual({ done: 0, failed: 1 });
  });

  it('does not run a row twice for two concurrent workers', async () => {
    const db = openProjectDb(':memory:', 'p');
    const clock = fakeClock();
    let n = 0;
    const effects = effectRegistry([
      defineEffect({
        key: 'slow',
        description: 's',
        handler: async () => void (n++, await Promise.resolve()),
      }),
    ]);
    enqueue(db, 'slow');
    await Promise.all([runOutbox({ db, effects, clock }), runOutbox({ db, effects, clock })]);
    expect(n).toBe(1);
  });

  it('runs effects outside any transaction (no write lock held while the handler runs)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ub-outbox-'));
    dirs.push(dir);
    const db = openProjectDb(dir, 'p');
    const other = openProjectDb(dir, 'p'); // a second connection to the same file
    other.exec('PRAGMA busy_timeout = 50');
    enqueue(db, 'probe');
    let wrote = false;
    const effects = effectRegistry([
      defineEffect({
        key: 'probe',
        description: 'writes through a second connection',
        handler: async () => {
          other.prepare('INSERT INTO outbox (run_id, kind, payload) VALUES (?, ?, ?)').run('r2', 'x', '{}'); // throws if db holds a write lock
          wrote = true;
        },
      }),
    ]);
    await runOutbox({ db, effects, clock: fakeClock() });
    expect(wrote).toBe(true);
    other.close();
    db.close();
  });

  it('webhook effect posts JSON and fails on non-2xx', async () => {
    const db = openProjectDb(':memory:', 'p');
    const seen: { url: string; body: string; key: string | undefined }[] = [];
    let status = 500;
    const effects = effectRegistry([
      webhookEffect(async (url, init) => {
        seen.push({ url, body: init.body, key: init.headers['idempotency-key'] });
        return { ok: status < 300, status };
      }),
    ]);
    const clock = fakeClock();
    enqueue(db, 'webhook', { url: 'https://x.test/h', body: { a: 1 } }, 'run-9');
    expect(await runOutbox({ db, effects, clock })).toEqual({ done: 0, failed: 1 });
    status = 200;
    clock.advance(1000);
    expect(await runOutbox({ db, effects, clock })).toEqual({ done: 1, failed: 0 });
    expect(seen[1]).toEqual({ url: 'https://x.test/h', body: '{"a":1}', key: 'run-9' });
  });
});
