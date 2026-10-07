/** The run ledger: `runs.id` is the idempotency key; `runs.result` holds what the run came to (migration 3). */
import { bindingFieldsOf, sameRunBinding } from '@ueberblick/core';
import type { Json, Key, Refusal, RecordedObservation, Run, RunId } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import type { SeqRange, SubmitResult } from './contract';

interface LedgerRow {
  outcome: string;
  result: string | null;
}
interface ObsRow {
  seq: number;
  run_id: string;
  feature_id: string;
  property: string;
  result: string | null;
  phenomenon_time: string | null;
  result_time: string | null;
}

/** What is stored in `runs.result`. */
type Stored = { readonly seq: SeqRange } | { readonly refusal: Refusal };

export interface RunRow {
  readonly run: Run;
  readonly receivedAt: string;
  readonly causedBy?: RunId;
  /** The feature the run is about (`runs.feature_id`, a projection like `features.pinned_version`): the run's own
   * `featureId`, or for an accepted create run the created feature; null for a refused create run. */
  readonly featureId?: string;
  /** Last seq of the run's own observations. */
  readonly seq?: number;
  readonly result: { readonly seq: SeqRange } | { readonly refusal: Refusal };
}

interface BoundRow {
  actor: string;
  actor_kind: string;
  task: string;
  input: string;
  feature_id: string | null;
  caused_by: string | null;
}

export interface Ledger {
  /**
   * Whether a submitted run may be answered from the ledger row of its id (WP-754): `new` (no row), `same` (the same
   * actor, task, input and, when given, feature: an idempotent offline retry) or `foreign` (anything else, including
   * a rule run's id). The client time and config version are not compared: a retry may be stamped again.
   */
  binding(run: Run): 'new' | 'same' | 'foreign';
  /** The stored result of a run id, or undefined when the id is new. */
  find(id: RunId): SubmitResult | undefined;
  insert(row: RunRow): void;
}

export function createLedger(db: Db): Ledger {
  const find = db.prepare<LedgerRow>('SELECT outcome, result FROM runs WHERE id = ?');
  const bound = db.prepare<BoundRow>(
    'SELECT actor, actor_kind, task, input, feature_id, caused_by FROM runs WHERE id = ?',
  );
  const range = db.prepare<ObsRow>(
    `SELECT seq, run_id, feature_id, property, result, phenomenon_time, result_time FROM observations
     WHERE seq BETWEEN ? AND ? ORDER BY seq`,
  );
  const insert = db.prepare(
    `INSERT INTO runs (id, actor, actor_kind, task, config_version, input, client_time, received_at,
                       outcome, refusal_code, caused_by, seq, result, feature_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    binding(run) {
      const row = bound.get(run.id);
      if (row === undefined) return 'new';
      const same = sameRunBinding(
        {
          actorId: row.actor,
          actorKind: row.actor_kind,
          task: row.task,
          input: JSON.parse(row.input),
          ...(row.feature_id === null ? {} : { featureId: row.feature_id }),
          ...(row.caused_by === null ? {} : { causedBy: row.caused_by }),
        },
        bindingFieldsOf(run),
      );
      return same ? 'same' : 'foreign';
    },

    find(id): SubmitResult | undefined {
      const row = find.get(id);
      if (row === undefined) return undefined;
      if (row.result === null) throw new Error(`ledger row ${id} has no stored result`);
      const stored = JSON.parse(row.result) as Stored;
      if ('refusal' in stored) return { outcome: 'refused', runId: id, refusal: stored.refusal };
      const observations = range.all(stored.seq.from, stored.seq.to).map((r): RecordedObservation => ({
        featureId: r.feature_id as RecordedObservation['featureId'],
        property: r.property,
        result: (r.result === null ? null : JSON.parse(r.result)) as Json,
        seq: r.seq,
        runId: r.run_id as RunId,
        ...(r.phenomenon_time === null ? {} : { phenomenonTime: r.phenomenon_time }),
        ...(r.result_time === null ? {} : { resultTime: r.result_time }),
      }));
      return { outcome: 'accepted', runId: id, seq: stored.seq, observations };
    },

    insert({ run, receivedAt, causedBy, seq, result, featureId }): void {
      const refused = 'refusal' in result;
      insert.run(
        run.id,
        run.actor.id,
        run.actor.kind,
        run.task as Key,
        run.configVersion,
        JSON.stringify(run.input),
        run.clientTime ?? null,
        receivedAt,
        refused ? 'rejected' : 'accepted',
        refused ? result.refusal.code : null,
        causedBy ?? null,
        seq ?? null,
        JSON.stringify(result),
        run.featureId ?? featureId ?? null,
      );
    },
  };
}
