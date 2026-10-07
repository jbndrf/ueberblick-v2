/**
 * The history of one feature (E-9): its runs, newest first, each with the observations it wrote on the feature or the
 * refusal it came to. A page is one keyset step over `runs_by_feature` (the run's rowid is the insertion order), plus one
 * range read of the feature's own observations (`observations_by_feature_seq`). Never touches runs of other features.
 */
import type { Json, TemplateFile } from '@ueberblick/core';
import type { Db } from '../../db/driver';
import { referenceNames } from './reference-names';
import { HISTORY_LIMIT, type HistoryOutcome } from './registry';

export interface HistoryObservation {
  readonly property: string;
  readonly result: Json;
  readonly time: string | null;
}

export interface HistoryRun {
  readonly id: string;
  readonly task: string;
  readonly actor: { readonly id: string; readonly kind: string; readonly name: string | null };
  /** When the server received the run, and when the device made it (null for a run made on the server). */
  readonly receivedAt: string;
  readonly clientTime: string | null;
  readonly configVersion: number;
  readonly outcome: HistoryOutcome;
  readonly refusal?: { readonly code: string; readonly message: string; readonly path?: string };
  /** In seq order; empty for a refused run. */
  readonly observations: readonly HistoryObservation[];
}

export interface HistoryPage {
  readonly runs: readonly HistoryRun[];
  /** The cursor of the next (older) page; null on the last one. */
  readonly next: string | null;
  /**
   * The names of the features the page's reference values point at, by id (core `displayName` of the current row,
   * WP-1076). A deleted feature is named like any other; an unknown id has no entry: the page shows core `shortId`.
   */
  readonly labels: Readonly<Record<string, string>>;
}

interface RunRaw {
  rk: number;
  id: string;
  actor: string;
  actor_kind: string;
  actor_name: string | null;
  task: string;
  config_version: number;
  client_time: string | null;
  received_at: string;
  outcome: string;
  result: string | null;
}
interface ObsRaw {
  seq: number;
  run_id: string;
  property: string;
  result: string | null;
  phenomenon_time: string | null;
}
interface Stored {
  seq?: { from: number; to: number };
  refusal?: { code: string; message: string; path?: string };
}

/** The cursor is the rowid of the last run of the page, as a decimal string. */
export const parseHistoryCursor = (raw: string | null): number | undefined | 'invalid' => {
  if (raw === null || raw === '') return undefined;
  return /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : 'invalid';
};

export interface HistoryOptions {
  readonly limit?: number;
  /** The name of an admin account (they live in the control database, not in `participants`); null when unknown. */
  readonly adminName?: (accountId: string) => string | null;
  /** The deployed types, to name the features the observations reference; without them `labels` is empty. */
  readonly types?: TemplateFile['types'];
}

export function featureHistory(
  db: Db,
  featureId: string,
  before: number | undefined,
  opts: HistoryOptions = {},
): HistoryPage {
  const limit = opts.limit ?? HISTORY_LIMIT;
  const raws = db
    .prepare<RunRaw>(
      `SELECT r.rowid AS rk, r.id, r.actor, r.actor_kind, p.name AS actor_name, r.task, r.config_version,
              r.client_time, r.received_at, r.outcome, r.result
       FROM runs r LEFT JOIN participants p ON p.id = r.actor
       WHERE r.feature_id = ?${before === undefined ? '' : ' AND r.rowid < ?'}
       ORDER BY r.rowid DESC LIMIT ?`,
    )
    .all(...(before === undefined ? [featureId] : [featureId, before]), limit + 1);
  const more = raws.length > limit;
  const page = more ? raws.slice(0, limit) : raws;
  const stored = page.map((r) => (r.result === null ? {} : (JSON.parse(r.result) as Stored)));
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of stored)
    if (s.seq !== undefined) {
      lo = Math.min(lo, s.seq.from);
      hi = Math.max(hi, s.seq.to);
    }
  const byRun = new Map<string, HistoryObservation[]>();
  if (lo <= hi) {
    const obs = db
      .prepare<ObsRaw>(
        `SELECT seq, run_id, property, result, phenomenon_time FROM observations
         WHERE feature_id = ? AND seq BETWEEN ? AND ? ORDER BY seq`,
      )
      .all(featureId, lo, hi);
    for (const o of obs) {
      const list = byRun.get(o.run_id) ?? [];
      list.push({
        property: o.property,
        result: (o.result === null ? null : JSON.parse(o.result)) as Json,
        time: o.phenomenon_time,
      });
      byRun.set(o.run_id, list);
    }
  }
  const runs = page.map((r, i): HistoryRun => {
    const refusal = (stored[i] as Stored).refusal;
    return {
      id: r.id,
      task: r.task,
      actor: {
        id: r.actor,
        kind: r.actor_kind,
        name: r.actor_kind === 'admin' ? (opts.adminName?.(r.actor) ?? null) : r.actor_name,
      },
      receivedAt: r.received_at,
      clientTime: r.client_time,
      configVersion: r.config_version,
      outcome: r.outcome === 'accepted' ? 'accepted' : 'refused',
      ...(refusal === undefined ? {} : { refusal }),
      observations: byRun.get(r.id) ?? [],
    };
  });
  const last = page[page.length - 1];
  return {
    runs,
    next: more && last !== undefined ? String(last.rk) : null,
    labels: labelsOf(db, featureId, runs, opts.types),
  };
}

/** One keyed read per distinct referenced id of the page (`referenceNames`, R14). */
function labelsOf(
  db: Db,
  featureId: string,
  runs: readonly HistoryRun[],
  types: TemplateFile['types'],
): Readonly<Record<string, string>> {
  const type = db.prepare<{ type: string }>('SELECT type FROM features WHERE id = ?').get(featureId)?.type;
  const def = type === undefined ? undefined : types?.[type];
  if (types === undefined || def === undefined) return {};
  const rows = runs.map((r) => Object.fromEntries(r.observations.map((o) => [o.property, o.result])));
  return Object.assign({}, ...Object.values(referenceNames(db, types, def, rows)));
}
