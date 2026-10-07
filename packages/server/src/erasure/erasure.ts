/**
 * The guarded purge of an erasure run (B-005, docs/research/gdpr-erasure.md §5). The single documented exception to
 * append-only, reachable only here: `erase` must be called inside the run transaction that appended the null
 * observations of `planRedaction` (R3). It overwrites the superseded results of the purged (feature, property) pairs
 * and the `runs.input` of the runs that wrote them with JSON null, records the subject in `erasure_subjects` and the run in `erasure_runs`, emits
 * the `redaction` and `blob` tombstones, removes blob rows nothing references any more and deletes the subject's
 * personal preference row (WP-612). A blanked value is JSON
 * `null`, exactly what the appended null observation stores, so every reader treats it as an ordinary value.
 *
 * Seam (H4, B-005): stored results pass through the SQL below only; a value codec (crypto-shredding) would sit here.
 */
import {
  redactionKey,
  type Json,
  type RedactPair,
  type RunId,
  type SyncTombstoneKind,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import { createChatStore } from '../modules/chat/store';
import { createPrefsStore } from '../prefs';
import { collectShas } from './shas';

const REDACTION: SyncTombstoneKind = 'redaction';
const BLOB: SyncTombstoneKind = 'blob';
const BLANK = 'null';

export interface ErasureInput {
  /** The subject id as recorded in `erasure_subjects`: a participant id (pseudonymous), or a feature id. */
  readonly subject: string;
  /** `RedactionPlan.purge` of `planRedaction`. */
  readonly purge: readonly RedactPair[];
  /** The erasure run itself: its own input (the subject) is kept. */
  readonly erasureRun: RunId | string;
  /** Erasure time, from the run's clock. */
  readonly at: string;
}

export interface ErasureResult {
  /** Observation rows blanked. */
  readonly purged: number;
  /** `runs.input` copies blanked. */
  readonly scrubbedRuns: number;
  /** Tombstones emitted (`redaction` and `blob`). */
  readonly tombstones: number;
  /** Blobs no value references any more: their rows are deleted, the caller deletes the bytes after commit. */
  readonly orphanedBlobs: readonly string[];
}

export interface Erasure {
  erase(input: ErasureInput): ErasureResult;
}

export function createErasure(db: Db): Erasure {
  const current = db.prepare<{ run_id: string; result: string }>(
    `SELECT run_id, result FROM observations WHERE feature_id = ? AND property = ? AND result IS NOT ?`,
  );
  const blank = db.prepare(
    'UPDATE observations SET result = ? WHERE feature_id = ? AND property = ? AND result IS NOT ?',
  );
  const blankRun = db.prepare('UPDATE runs SET input = ? WHERE id = ? AND input IS NOT ?');
  const guard = db.prepare('UPDATE erasure_guard SET open = ? WHERE id = 1');
  const head = db.prepare<{ seq: number }>(
    `SELECT max(coalesce((SELECT max(seq) FROM observations), 0), coalesce((SELECT max(seq) FROM tombstones), 0)) AS seq`,
  );
  const tombstone = db.prepare('INSERT INTO tombstones (seq, kind, id) VALUES (?, ?, ?)');
  const dropRefs = db.prepare('DELETE FROM blob_refs WHERE feature_id = ? AND property = ?');
  const dropBlob = db.prepare('DELETE FROM blobs WHERE sha256 = ?');
  const values = db.prepare<{ result: string }>(
    `SELECT result FROM observations WHERE instr(result, '"sha256"') > 0`,
  );
  const inputs = db.prepare<{ input: string }>(`SELECT input FROM runs WHERE instr(input, '"sha256"') > 0`);
  const subject = db.prepare(
    `INSERT INTO erasure_subjects (subject, erased_at) VALUES (?, ?) ON CONFLICT (subject) DO UPDATE SET erased_at = excluded.erased_at`,
  );

  const erasureRun = db.prepare(
    'INSERT INTO erasure_runs (run_id, subject, erased_at) VALUES (?, ?, ?) ON CONFLICT (run_id, subject) DO NOTHING',
  );
  return {
    erase(input): ErasureResult {
      return db.transaction(() => {
        db.exec('PRAGMA secure_delete = ON');
        erasureRun.run(String(input.erasureRun), input.subject, input.at);
        const affected: RedactPair[] = [];
        const runs = new Set<string>();
        const candidates = new Set<string>();
        for (const p of input.purge) {
          dropRefs.run(p.featureId, p.property);
          const rows = current.all(p.featureId, p.property, BLANK);
          if (rows.length === 0) continue;
          affected.push(p);
          for (const r of rows) {
            if (r.run_id !== input.erasureRun) runs.add(r.run_id);
            collectShas(JSON.parse(r.result) as Json, candidates);
          }
        }
        let purged = 0;
        let scrubbedRuns = 0;
        guard.run(1);
        try {
          for (const p of affected) purged += blank.run(BLANK, p.featureId, p.property, BLANK).changes;
          for (const id of runs) scrubbedRuns += blankRun.run(BLANK, id, BLANK).changes;
        } finally {
          guard.run(0);
        }

        let seq = (head.get() as { seq: number }).seq;
        for (const p of affected) tombstone.run(++seq, REDACTION, redactionKey(p.featureId, p.property));
        let tombstones = affected.length;

        const orphaned: string[] = [];
        if (candidates.size > 0) {
          const referenced = new Set<string>();
          for (const r of values.all()) collectShas(JSON.parse(r.result) as Json, referenced);
          for (const r of inputs.all()) collectShas(JSON.parse(r.input) as Json, referenced);
          for (const sha of [...candidates].sort()) {
            if (referenced.has(sha)) continue;
            dropBlob.run(sha);
            tombstone.run(++seq, BLOB, sha);
            orphaned.push(sha);
            tombstones++;
          }
        }
        // The subject's personal preference record (WP-612) is erased with the rest. `remove` deletes the row for
        // the subject id and nothing when there is none: a feature subject (a minted UUIDv7) is never a prefs key
        // (participant slugs, admin UUIDv4 accounts).
        createPrefsStore(db, { now: () => input.at }).remove(input.subject);
        // The subject's chat messages (B-020): authored ones are deleted, mentions of the subject (a person or a feature id)
        // are cut from other messages and from the mention index.
        createChatStore(db, { now: () => input.at }).erase(input.subject);
        // Always upsert: a subject whose pairs another call already blanked must still carry this erasure's time.
        subject.run(input.subject, input.at);
        return { purged, scrubbedRuns, tombstones, orphanedBlobs: orphaned };
      });
    },
  };
}
