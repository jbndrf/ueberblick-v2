/**
 * Builds the runs of one phase for one chunk of records. Creations go through `planRows` (server import, WP-111):
 * it checks the values against the property types and reprojects and validates the position. History and links
 * are update runs of `<type>_import_update`; `planRows` serves creating tasks only, so those are built here.
 */
import type { FeatureId, Geometry, Json, Run } from '@ueberblick/core';
import { planRows, type ImportMapping, type ImportRow } from '@ueberblick/server';
import type { Mapping } from '../config/convert';
import { runIdFor } from './ids';
import type { ImportTarget } from '../config';
import { prepare, type Prepared, type PrepareEnv } from './prepare';
import { toInstant } from './read';
import type { DataProblem, IdMap, V3DataExport, V3InstanceRecord, V3TableRecord } from './types';
import { convertValue } from './values';

export interface BuildEnv extends PrepareEnv {
  readonly configVersion: number;
  readonly ids: IdMap;
  readonly index: RecordIndex;
}

export interface Built {
  readonly runs: Run[];
  readonly sources: string[];
  readonly problems: DataProblem[];
}

/** What every phase needs to know about all records: which type a v3 id became, and the rows of the tables. */
export interface RecordIndex {
  /** v3 record id to the v4 feature type key. */
  readonly typeOf: ReadonlyMap<string, string>;
  /** v4 table type key to (NFC text of any column) to the row ids. */
  byValue(type: string): ReadonlyMap<string, readonly string[]>;
}

export function indexRecords(v3: V3DataExport, mapping: Mapping): RecordIndex {
  const typeOf = new Map<string, string>();
  for (const i of v3.instances) {
    const t = mapping.types[i.workflow];
    if (t !== undefined) typeOf.set(i.id, t.type);
  }
  const rowsOf = new Map<string, V3TableRecord[]>();
  for (const r of v3.tableRows) {
    const t = mapping.tables[r.table];
    if (t === undefined) continue;
    typeOf.set(r.id, t.type);
    rowsOf.set(t.type, [...(rowsOf.get(t.type) ?? []), r]);
  }
  const cache = new Map<string, Map<string, string[]>>();
  return {
    typeOf,
    byValue(type) {
      let m = cache.get(type);
      if (m === undefined) {
        m = new Map();
        for (const r of rowsOf.get(type) ?? [])
          for (const v of Object.values(r.values))
            if (typeof v === 'string')
              m.set(v.normalize('NFC'), [...(m.get(v.normalize('NFC')) ?? []), r.id]);
        cache.set(type, m);
      }
      return m;
    },
  };
}

const IMPORT_ACTOR = (id: string) => ({ id, kind: 'import' as const, roles: [] });

/** The `ImportMapping` of a creating task: every property except position, files and localized text. */
function mappingFor(target: ImportTarget, task: string, type: string): ImportMapping {
  const def = target.file.types?.[type];
  const geometry = def?.geometry;
  const fields: Record<string, string> = {};
  for (const [key, p] of Object.entries(def?.properties ?? {}))
    if (key !== geometry && p.type !== 'file' && p.type !== 'localized_text') fields[key] = key;
  return {
    task: task as ImportMapping['task'],
    fields,
    ...(geometry !== undefined ? { geometry: { field: geometry } } : {}),
    sourceCrs: 'EPSG:4326',
  };
}

interface Creation {
  readonly source: string;
  readonly type: string;
  readonly task: string;
  readonly actor: string;
  readonly time: string | undefined;
  readonly values: Readonly<Record<string, Json>>;
  readonly geometry?: Geometry;
}

/** Creation runs through `planRows`. A row it refuses is a problem, not a run (mode `skip`). */
function creations(items: readonly Creation[], env: BuildEnv, out: Built): void {
  const byTask = new Map<string, Creation[]>();
  for (const c of items) byTask.set(c.task, [...(byTask.get(c.task) ?? []), c]);
  for (const [task, group] of byTask) {
    const first = group[0] as Creation;
    const rows: ImportRow[] = group.map((c, i) => ({
      row: i + 1,
      values: c.values,
      ...(c.geometry !== undefined ? { geometry: c.geometry } : {}),
    }));
    const plan = planRows(
      rows,
      mappingFor(env.target, task, first.type),
      {
        config: env.target.config,
        configVersion: env.configVersion,
        actor: IMPORT_ACTOR('v3'),
        ids: {
          runId: () => runIdFor('unused'),
          featureId: () => {
            throw new Error('feature ids are minted by plan');
          },
        },
        geo: env.geo,
      },
      { mode: 'skip' },
    );
    for (const p of plan.problems) {
      const c = group[p.row - 1];
      out.problems.push({
        code: p.code === 'geometry_invalid' ? 'no_geometry' : 'no_counterpart',
        record: c?.source ?? task,
        message: `${p.path ?? task}: ${p.message}`,
      });
    }
    plan.runs.forEach((run, i) => {
      const c = group[(plan.rows[i] as number) - 1] as Creation;
      out.runs.push({
        ...run,
        id: runIdFor('create', c.source),
        actor: IMPORT_ACTOR(c.actor),
        ...(c.time !== undefined ? { clientTime: c.time } : {}),
      });
      out.sources.push(c.source);
    });
  }
}

const empty = (): Built => ({ runs: [], sources: [], problems: [] });

/** Rows of the custom tables. */
export function tableRuns(rows: readonly V3TableRecord[], env: BuildEnv): Built {
  const out = empty();
  const items: Creation[] = [];
  for (const r of rows) {
    const type = env.mapping.tables[r.table];
    const tasks = type === undefined ? undefined : env.target.tasks[type.type];
    if (type === undefined || tasks === undefined) {
      out.problems.push({
        code: 'unknown_table',
        record: r.id,
        message: `table "${r.table}" is not in the converted project`,
      });
      continue;
    }
    const values: Record<string, Json> = {};
    for (const [column, raw] of Object.entries(r.values)) {
      const p = type.properties[column];
      const v = p === undefined ? undefined : convertValue(p, raw);
      if (p === undefined || v === undefined)
        out.problems.push({
          code: p === undefined ? 'unknown_field' : 'no_counterpart',
          record: r.id,
          message: `column "${column}"`,
        });
      else if (v !== null) values[p.property] = v;
    }
    items.push({
      source: r.id,
      type: type.type,
      task: tasks.create,
      actor: 'v3',
      time: toInstant(r.createdAt),
      values,
    });
  }
  creations(items, env, out);
  return out;
}

/** The features themselves: position, stage, status, creator and the first run's values. */
export function createRuns(records: readonly V3InstanceRecord[], env: BuildEnv): Built {
  const out = empty();
  const items: Creation[] = [];
  for (const rec of records) {
    const p = prepare(rec, env, out.problems);
    if (p === undefined) continue;
    items.push({
      source: rec.id,
      type: p.type.type,
      task: p.tasks.create,
      actor: p.actor,
      time: p.createTime,
      values: p.createValues,
      ...(p.geometry !== undefined ? { geometry: p.geometry } : {}),
    });
  }
  creations(items, env, out);
  return out;
}

const update = (
  p: Prepared,
  featureId: FeatureId,
  input: Record<string, Json>,
  seed: readonly (string | number)[],
  step: { readonly time: string | undefined; readonly observer: string | undefined },
  env: BuildEnv,
): Run => ({
  id: runIdFor(...seed),
  task: p.tasks.update as Run['task'],
  actor: IMPORT_ACTOR(step.observer ?? p.actor),
  configVersion: env.configVersion,
  featureId,
  input,
  ...(step.time !== undefined ? { clientTime: step.time } : {}),
});

/** One update run per later v3 run, in v3 order. */
export function historyRuns(records: readonly V3InstanceRecord[], env: BuildEnv): Built {
  const out = empty();
  for (const rec of records) {
    const p = prepare(rec, env, []);
    if (p === undefined) continue;
    const id = env.ids.get(rec.id);
    if (id === undefined) {
      out.problems.push({
        code: 'refused',
        record: rec.id,
        message: 'the feature was not created, so its history is left out',
      });
      continue;
    }
    for (const step of p.steps) {
      if (Object.keys(step.values).length === 0) continue;
      out.runs.push(update(p, id, { ...step.values }, ['history', rec.id, step.index], step, env));
      out.sources.push(rec.id);
    }
  }
  return out;
}

/** The v3 record a reference names: its id, or (a custom table selector) the value of one of its columns. */
function resolve(v3: string, to: string | undefined, env: BuildEnv): string | undefined {
  if (env.index.typeOf.has(v3)) return v3;
  if (to === undefined) return undefined;
  const hits = env.index.byValue(to).get(v3.normalize('NFC'));
  return hits?.length === 1 ? hits[0] : undefined;
}

/** References, once every feature has its id. A many-valued relation is written on the children, as v4 stores it. */
export function linkRuns(records: readonly V3InstanceRecord[], env: BuildEnv): Built {
  const out = empty();
  for (const rec of records) {
    const p = prepare(rec, env, []);
    const owner = p === undefined ? undefined : env.ids.get(rec.id);
    if (p === undefined || owner === undefined) continue;
    const current = new Map<string, Set<string>>();
    for (const step of p.steps) {
      const own: Record<string, Json> = {};
      const problem = (code: DataProblem['code'], message: string): void =>
        void out.problems.push({ code, record: rec.id, message });
      for (const ref of step.refs) {
        const to = ref.inverse?.type ?? env.target.file.types?.[p.type.type]?.properties[ref.property]?.to;
        const targets = ref.targets.flatMap((t) => {
          const hit = resolve(t, to, env);
          if (hit === undefined)
            problem('unresolved_reference', `"${ref.property}" points at "${t}", which was not converted`);
          return hit === undefined ? [] : [hit];
        });
        if (ref.inverse === undefined) {
          if (targets.length > 1)
            problem(
              'reference_dropped',
              `"${ref.property}" held ${targets.length} records; the first is kept`,
            );
          const id = targets[0] === undefined ? undefined : env.ids.get(targets[0]);
          own[ref.property] = id ?? null;
          continue;
        }
        const now = new Set(targets);
        const before = current.get(ref.property) ?? new Set<string>();
        current.set(ref.property, now);
        const changes = [
          ...[...before].filter((c) => !now.has(c)).map((c) => [c, null] as const),
          ...[...now].filter((c) => !before.has(c)).map((c) => [c, owner] as const),
        ];
        for (const [child, value] of changes) {
          const childId = env.ids.get(child);
          const childType = env.index.typeOf.get(child);
          const tasks = childType === undefined ? undefined : env.target.tasks[childType];
          if (childId === undefined || tasks === undefined) {
            problem('unresolved_reference', `"${ref.property}": "${child}" has no feature`);
            continue;
          }
          out.runs.push({
            id: runIdFor('link', rec.id, step.index, ref.property, child),
            task: tasks.update as Run['task'],
            actor: IMPORT_ACTOR(step.observer ?? p.actor),
            configVersion: env.configVersion,
            featureId: childId,
            input: { [ref.inverse.property]: value },
            ...(step.time !== undefined ? { clientTime: step.time } : {}),
          });
          out.sources.push(child);
        }
      }
      if (Object.keys(own).length > 0) {
        out.runs.push(update(p, owner, own, ['link', rec.id, step.index], step, env));
        out.sources.push(rec.id);
      }
    }
  }
  return out;
}
