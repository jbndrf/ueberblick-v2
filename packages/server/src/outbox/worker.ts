import type { Clock } from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { EffectRegistry } from './effects';

export interface OutboxOptions {
  readonly db: Db;
  readonly effects: EffectRegistry;
  readonly clock: Clock;
  /** Rows taken per call. Default 50. */
  readonly batch?: number;
  /** Executions per row before it stays failed. Default 8. */
  readonly maxAttempts?: number;
  /** Delay after the first failure; doubles each attempt. Default 1000 ms. */
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** A claimed row is not offered again for this long (covers a crash mid-effect). Default 5 min. */
  readonly leaseMs?: number;
}

export interface OutboxResult {
  readonly done: number;
  /** Failed this time and scheduled for a later retry, or out of attempts. */
  readonly failed: number;
}

interface Row {
  id: number;
  run_id: string;
  kind: string;
  payload: string;
  attempts: number;
}

const later = (iso: string, ms: number): string => new Date(Date.parse(iso) + ms).toISOString();

/**
 * One pass over the due outbox rows. Effects run here, never inside the run transaction (F3): each row is
 * claimed in a short transaction, the handler runs with no transaction open, and the result is written
 * afterwards. A row marked done is never selected again, so a success is never repeated.
 */
export async function runOutbox(opts: OutboxOptions): Promise<OutboxResult> {
  const { db, effects, clock } = opts;
  const maxAttempts = opts.maxAttempts ?? 8;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 3_600_000;
  const leaseMs = opts.leaseMs ?? 300_000;

  const due = db.prepare<Row>(
    `SELECT id, run_id, kind, payload, attempts FROM outbox
     WHERE done_at IS NULL AND attempts < ? AND (next_at IS NULL OR next_at <= ?)
     ORDER BY id LIMIT ?`,
  );
  const claim = db.prepare(
    `UPDATE outbox SET attempts = attempts + 1, next_at = ?
     WHERE id = ? AND done_at IS NULL AND attempts = ?`,
  );
  const markDone = db.prepare('UPDATE outbox SET done_at = ?, next_at = NULL WHERE id = ?');
  const markFailed = db.prepare('UPDATE outbox SET next_at = ? WHERE id = ?');

  let done = 0;
  let failed = 0;
  for (const row of due.all(maxAttempts, clock.now(), opts.batch ?? 50)) {
    // Compare-and-set on `attempts`: a second worker that saw the same row loses the claim.
    if (claim.run(later(clock.now(), leaseMs), row.id, row.attempts).changes !== 1) continue;
    const attempt = row.attempts + 1;
    try {
      const effect = effects.get(row.kind);
      if (!effect) throw new Error(`no effect registered for kind "${row.kind}"`);
      await effect.handler(JSON.parse(row.payload) as unknown, { runId: row.run_id, attempt });
      markDone.run(clock.now(), row.id);
      done++;
    } catch {
      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      markFailed.run(later(clock.now(), delay), row.id);
      failed++;
    }
  }
  return { done, failed };
}
