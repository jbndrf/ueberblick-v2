/**
 * The Protokoll of one run (WP-372, owner A3): the run's task form, filled with the values the run wrote, from the
 * run's own config version (A-029: an old run shows its old form). The server decides what the viewer may read, so the
 * client never filters: an admin viewer sees every field (as the Daten tab and the data table do), a participant or role
 * viewer only `perms.forType(type).readable(subjects)`, the call the sync makes (R1). The visibility is one function,
 * `visibleProperties`, so a participant-facing Protokoll reuses it.
 */
import type { Actor, Json, LocalizedString, Perms, Property, Task, TemplateFile } from '@ueberblick/core';
import { referenceNames } from './reference-names';
import type { Db } from '../../db/driver';
import type { VersionCache } from '../../store/run/config-for';
import type { ProtokollMiss } from './protokoll-registry';

export interface ProtokollRun {
  readonly id: string;
  readonly task: string;
  /** The task's label in the run's own version; null when that version has no such task. */
  readonly taskLabel: LocalizedString | null;
  readonly actor: { readonly id: string; readonly kind: string; readonly name: string | null };
  readonly receivedAt: string;
  readonly clientTime: string | null;
  readonly configVersion: number;
}

export interface Protokoll {
  readonly run: ProtokollRun;
  readonly type: string;
  /** The form entries and their properties as the run's version had them, readable ones only (input of `buildFormModel`). */
  readonly form: NonNullable<Task['form']>;
  readonly properties: Readonly<Record<string, Property>>;
  /** The values the run wrote on the form's readable properties. */
  readonly values: Readonly<Record<string, Json>>;
  /**
   * The name (core `displayName`, current store row) of every feature the reference values point at, by id. A deleted feature is named like any other; an
   * unknown id has no entry: the page shows core `shortId`, never the raw id (WP-1076, WP-1077).
   */
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * The properties of `keys` that `viewer` may read. Only participants are bound by role allowlists (system, import and
 * admin actors are not, golden semantics 2); a bound viewer gets what `Perms.readable` gives for its subjects.
 */
export function visibleProperties(
  perms: Perms,
  type: string,
  viewer: Actor,
  keys: readonly string[],
): ReadonlySet<string> {
  if (viewer.kind !== 'participant') return new Set(keys);
  const readable = perms.forType(type as never)?.readable(perms.subjects(viewer)) ?? new Set<string>();
  return new Set(keys.filter((k) => readable.has(k)));
}

interface RunRow {
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
interface ObsRow {
  property: string;
  result: string | null;
}

export function protokollOf(
  db: Db,
  versions: VersionCache,
  featureId: string,
  runId: string,
  viewer: Actor,
): Protokoll | ProtokollMiss {
  const r = db
    .prepare<RunRow>(
      `SELECT r.id, r.actor, r.actor_kind, p.name AS actor_name, r.task, r.config_version, r.client_time,
              r.received_at, r.outcome, r.result
       FROM runs r LEFT JOIN participants p ON p.id = r.actor WHERE r.id = ? AND r.feature_id = ?`,
    )
    .get(runId, featureId);
  if (r === undefined) return 'run_not_found';
  if (r.outcome !== 'accepted') return 'run_refused';
  const version = versions.get(r.config_version);
  if (version === undefined) return 'version_gone';
  const stored = r.result === null ? {} : (JSON.parse(r.result) as { seq?: { from: number; to: number } });
  const feature = db.prepare<{ type: string }>('SELECT type FROM features WHERE id = ?').get(featureId);
  if (feature === undefined) return 'run_not_found';
  const type = feature.type;
  const task = version.config.file.tasks?.[r.task];
  const def = version.config.file.types?.[type];
  // What the run wrote on this feature, in write order (the last value of a property wins).
  const written = new Map<string, Json>();
  if (stored.seq !== undefined) {
    const obs = db
      .prepare<ObsRow>(
        `SELECT property, result FROM observations
         WHERE feature_id = ? AND run_id = ? AND seq BETWEEN ? AND ? ORDER BY seq`,
      )
      .all(featureId, runId, stored.seq.from, stored.seq.to);
    for (const o of obs) written.set(o.property, (o.result === null ? null : JSON.parse(o.result)) as Json);
  }
  // A task without a form (a quick edit, a location step) has no fields to show: its record is one page of the
  // properties it wrote, which the type of that version declares. Same filter, same renderer.
  const declared = (k: string): boolean => def?.properties[k] !== undefined;
  const taskForm = task?.form ?? {};
  const entries: [string, NonNullable<Task['form']>[string]][] =
    Object.keys(taskForm).length > 0
      ? Object.entries(taskForm).filter(([k]) => declared(k))
      : [...written.keys()].filter(declared).map((k) => [k, {}]);
  const visible = visibleProperties(
    version.perms,
    type,
    viewer,
    entries.map(([k]) => k),
  );
  const form = Object.fromEntries(entries.filter(([k]) => visible.has(k)));
  const properties = Object.fromEntries(
    Object.keys(form).map((k) => [k, (def as NonNullable<typeof def>).properties[k] as Property]),
  );
  const values: Record<string, Json> = {};
  for (const [k, v] of written) if (k in form) values[k] = v;
  return {
    run: {
      id: r.id,
      task: r.task,
      taskLabel: task?.label ?? null,
      actor: { id: r.actor, kind: r.actor_kind, name: r.actor_name },
      receivedAt: r.received_at,
      clientTime: r.client_time,
      configVersion: r.config_version,
    },
    type,
    form,
    properties,
    values,
    labels: labelsOf(db, version.config.file.types ?? {}, def, values),
  };
}

/** Per-id names over the run's reference values: one keyed read per distinct id (`referenceNames`, R14). */
function labelsOf(
  db: Db,
  types: NonNullable<TemplateFile['types']>,
  def: NonNullable<TemplateFile['types']>[string] | undefined,
  values: Readonly<Record<string, Json>>,
): Readonly<Record<string, string>> {
  if (def === undefined) return {};
  return Object.assign({}, ...Object.values(referenceNames(db, types, def, [values])));
}
