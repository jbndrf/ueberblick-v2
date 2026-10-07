/**
 * Run rows on sync pages (WP-601): one `SyncRun` per run that wrote an observation on the page, so the device holds
 * what the Aktivität timeline shows. One indexed query by run id per page, never per feature (R14).
 *
 * Actor clipping: `actor` is the participant id when one of the receiver's roles has `app.activity_names` (default
 * true) or the run is the receiver's own; otherwise null. `people` names the actor ids that survive the clipping.
 * The scope fingerprint covers the setting, so a change makes the device re-snapshot.
 */
import {
  choosesAnyParticipant,
  scopeFingerprint,
  type RunId,
  type SyncObservation,
  type SyncPerson,
  type SyncRun,
} from '@ueberblick/core';
import type { Db } from '../db/driver';
import type { Scope } from './visibility';

/** True when a role of the receiver may see who made other people's changes. No role at all: false. */
export function seesNames(scope: Pick<Scope, 'actor' | 'config'>): boolean {
  return scope.actor.roles.some((r) => scope.config.file.roles?.[r]?.app?.activity_names !== false);
}

/** True when the receiver may choose any participant by name for some participant property (`select.all`, WP-725). */
export function seesChoosable(scope: Pick<Scope, 'actor' | 'config'>): boolean {
  return choosesAnyParticipant(scope.config.file.types, scope.actor.roles);
}

const withNames = new WeakMap<Scope, Scope>();

/** The scope with its fingerprint extended by the activity-names setting; cached per scope. */
export function withActivityNames(scope: Scope): Scope {
  let out = withNames.get(scope);
  if (out === undefined) {
    out = {
      ...scope,
      fingerprint: scopeFingerprint([
        scope.fingerprint,
        `activity_names:${seesNames(scope)}`,
        `choosable:${seesChoosable(scope)}`,
      ]),
    };
    withNames.set(scope, out);
  }
  return out;
}

interface RunRow {
  readonly id: string;
  readonly actor: string;
  readonly task: string;
  readonly client_time: string | null;
  readonly received_at: string;
  readonly seq: number | null;
  readonly caused_by: string | null;
}

const ms = (iso: string | null): number | null => {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** The runs with these ids, actor clipped for `scope`'s actor. Ids come from observations already clipped. */
export function readRuns(
  db: Db,
  scope: Pick<Scope, 'actor' | 'config'>,
  runIds: readonly string[],
): SyncRun[] {
  if (runIds.length === 0) return [];
  const names = seesNames(scope);
  const rows = db
    .prepare<RunRow>(
      `SELECT id, actor, task, client_time, received_at, seq, caused_by FROM runs
       WHERE id IN (SELECT value FROM json_each(?)) ORDER BY seq`,
    )
    .all(JSON.stringify(runIds));
  return rows.map((r) => ({
    id: r.id as RunId,
    task: r.task,
    actor: names || r.actor === scope.actor.id ? r.actor : null,
    clientTime: ms(r.client_time),
    receivedAt: ms(r.received_at) ?? 0,
    seq: r.seq ?? 0,
    causedBy: r.caused_by as RunId | null,
  }));
}

/** The names of the actors in `runs` that have one. Only called with already clipped runs. */
export function readPeople(db: Db, runs: readonly SyncRun[]): SyncPerson[] {
  const actors = [...new Set(runs.flatMap((r) => (r.actor === null ? [] : [r.actor])))];
  if (actors.length === 0) return [];
  return db
    .prepare<{ id: string; name: string }>(
      `SELECT id, name FROM participants WHERE name IS NOT NULL AND id IN (SELECT value FROM json_each(?)) ORDER BY id`,
    )
    .all(JSON.stringify(actors));
}

/** The `runs` and `people` of a page: the runs of its observations, a run only when an observation of it is on it. */
export function runsOfPage(
  db: Db,
  scope: Pick<Scope, 'actor' | 'config'>,
  observations: readonly SyncObservation[],
): { runs: SyncRun[]; people: SyncPerson[] } {
  const runs = readRuns(db, scope, [...new Set(observations.map((o) => o.runId))]);
  return { runs, people: readPeople(db, runs) };
}
