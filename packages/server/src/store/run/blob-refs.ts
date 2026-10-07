/**
 * Blob references of the run transaction (WP-604). A file value is `{sha256, name, mime}`; its bytes arrive through the
 * blob route BEFORE the run, so a run may only name bytes the server holds (`missing`). Every file value an accepted run
 * writes is recorded in `blob_refs` (`record`), which is what the download route authorises against.
 *
 * Owning the hash (WP-757): a participant's run may name a hash only when the actor uploaded the bytes (`blob_uploads`),
 * the file is already on the run's subject feature, an earlier accepted run of the same actor named it, or the actor
 * may already read it (WP-774: the same `BlobAccess` check GET and HEAD use, judged on the state before the run, so a
 * run cannot grant itself the file; a HEAD 200 lets the device skip the PUT, so this leg keeps that flow working). Otherwise a
 * hash seen once would grant the file back after access was revoked. Admin, import and system actors and rule runs
 * are not asked: they are trusted by R3 or copy values an already-checked run wrote.
 */
import type { Actor, PlannedRun, Refusal, RecordedObservation } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { collectShas } from '../../erasure';

export interface BlobRefs {
  /**
   * The first planned run whose observations name a sha256 with no stored blob (`blob_missing`), else the first
   * participant run naming a hash the actor neither uploaded nor already holds (`not_permitted`), with its refusal.
   */
  missing(planned: readonly PlannedRun[]): { readonly runId: string; readonly refusal: Refusal } | undefined;
  /** One row per (sha256, feature, property, run) of the observations. Idempotent. */
  record(observations: readonly RecordedObservation[]): void;
}

/** The read check of the blob route (`http/blobs/access.ts`); one definition (R1). */
export interface BlobReadCheck {
  allowed(actor: Actor, sha256: string): boolean;
}

export function createBlobRefs(db: Db, access: BlobReadCheck): BlobRefs {
  const has = db.prepare('SELECT 1 AS x FROM blobs WHERE sha256 = ?');
  const insert = db.prepare(
    'INSERT OR IGNORE INTO blob_refs (sha256, feature_id, property, run_id) VALUES (?, ?, ?, ?)',
  );
  const uploaded = db.prepare(
    'SELECT 1 AS x FROM blob_uploads WHERE sha256 = ? AND actor = ? AND actor_kind = ?',
  );
  const onSubject = db.prepare('SELECT 1 AS x FROM blob_refs WHERE sha256 = ? AND feature_id = ? LIMIT 1');
  const authored = db.prepare(
    `SELECT 1 AS x FROM blob_refs b JOIN runs r ON r.id = b.run_id
     WHERE b.sha256 = ? AND r.actor = ? AND r.actor_kind = ? LIMIT 1`,
  );
  const shasOf = (result: RecordedObservation['result']): Set<string> => {
    const out = new Set<string>();
    if (result !== null && typeof result === 'object') collectShas(result, out);
    return out;
  };
  type Verdict = { readonly runId: string; readonly refusal: Refusal };
  function absent(planned: readonly PlannedRun[]): Verdict | undefined {
    for (const p of planned)
      for (const o of p.observations)
        for (const sha of shasOf(o.result))
          if (has.get(sha) === undefined)
            return {
              runId: p.run.id,
              refusal: {
                code: 'blob_missing',
                message: `property ${o.property} names the file ${sha}, which was not uploaded (PUT it first)`,
              },
            };
    return undefined;
  }
  function unowned(planned: readonly PlannedRun[]): Verdict | undefined {
    for (const p of planned) {
      const { actor } = p.run;
      if (p.rule !== undefined || actor.kind !== 'participant') continue;
      for (const o of p.observations)
        for (const sha of shasOf(o.result))
          if (
            uploaded.get(sha, actor.id, actor.kind) === undefined &&
            onSubject.get(sha, o.featureId) === undefined &&
            authored.get(sha, actor.id, actor.kind) === undefined &&
            !access.allowed(actor, sha)
          )
            return {
              runId: p.run.id,
              refusal: {
                code: 'not_permitted',
                message: `property ${o.property} names the file ${sha}, which this actor did not upload`,
              },
            };
    }
    return undefined;
  }
  return {
    missing: (planned) => absent(planned) ?? unowned(planned),
    record(observations) {
      for (const o of observations)
        for (const sha of shasOf(o.result)) insert.run(sha, o.featureId, o.property, o.runId);
    },
  };
}
