/**
 * One v3 instance as the runs it becomes: the values of its creation, and one step per later run. Pure: it
 * reads no store, so the phases can prepare the same instance again and get the same answer.
 */
import type { Geo, Geometry, Json } from '@ueberblick/core';
import { prepareGeometry } from '@ueberblick/server';
import type { Mapping, TypeMapping } from '../config/convert';
import { slug } from '../config/keys';
import { steps as historySteps } from './history';
import type { ImportTasks, ImportTarget } from '../config';
import { toInstant } from './read';
import type { DataProblem, V3InstanceRecord, V3LogRow } from './types';
import { convertValue } from './values';

export interface PrepareEnv {
  readonly mapping: Mapping;
  readonly target: ImportTarget;
  readonly geo: Geo;
}

/** The v3 targets of one reference field at one step. */
export interface RefEntry {
  readonly property: string;
  /** Set when the field is a many-valued relation: the children point back through it. */
  readonly inverse?: { readonly type: string; readonly property: string };
  readonly targets: readonly string[];
}

export interface PreparedStep {
  readonly index: number;
  readonly time: string | undefined;
  readonly observer: string | undefined;
  readonly values: Readonly<Record<string, Json>>;
  readonly refs: readonly RefEntry[];
}

export interface Prepared {
  readonly rec: V3InstanceRecord;
  readonly type: TypeMapping;
  readonly tasks: ImportTasks;
  readonly actor: string;
  readonly createTime: string | undefined;
  /** The values of the creation run, without the geometry. */
  readonly createValues: Readonly<Record<string, Json>>;
  /** The position of the creation run, as v3 wrote it (`planRows` reprojects and validates it). */
  readonly geometry: Geometry | undefined;
  /** The v3 runs after the creation, in v3 order. */
  readonly steps: readonly PreparedStep[];
}

const isGeometry = (g: unknown): g is Geometry =>
  typeof g === 'object' && g !== null && typeof (g as { type?: unknown }).type === 'string';

const refIds = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string');
  if (typeof raw !== 'string' || raw === '') return [];
  if (raw.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      return [raw];
    }
  }
  return [raw];
};

export function prepare(
  rec: V3InstanceRecord,
  env: PrepareEnv,
  problems: DataProblem[],
): Prepared | undefined {
  const problem = (code: DataProblem['code'], message: string): void =>
    void problems.push({ code, record: rec.id, message });
  const type = env.mapping.types[rec.workflow];
  const tasks = type === undefined ? undefined : env.target.tasks[type.type];
  if (type === undefined || tasks === undefined) {
    problem('unknown_workflow', `workflow "${rec.workflow}" is not in the converted project`);
    return undefined;
  }
  /** The lifecycle option of a v3 status; `active` is the default of a new feature, other statuses need the option. */
  const lifecycle = (status: string): string | undefined => {
    const key = slug(status, 's');
    const options =
      type.lifecycle === undefined
        ? undefined
        : env.target.file.types?.[type.type]?.properties[type.lifecycle]?.options;
    if (options !== undefined && Object.hasOwn(options, key)) return key;
    if (status !== 'active')
      problem('no_counterpart', `status "${status}" has no lifecycle option in the converted project`);
    return undefined;
  };
  const all = historySteps(rec.log);
  const systemRows = (name: V3LogRow['system']): boolean => rec.log.some((r) => r.system === name);

  // The creation carries the first position, and the current stage and status when v3 kept no history of them.
  let firstGeometry: unknown = rec.geometry;
  const geometryRow = all.flatMap((s) => s.rows).find((r) => r.system === 'geometry');
  if (geometryRow !== undefined) firstGeometry = geometryRow.value;
  const meta: Record<string, Json> = {};
  if (rec.stage !== undefined && type.stage !== undefined && !systemRows('stage')) {
    const key = type.stage.options[rec.stage];
    if (key === undefined) problem('unknown_stage', `stage "${rec.stage}" is not in the converted project`);
    else meta[type.stage.property] = key;
  }
  if (rec.status !== undefined && !systemRows('status')) {
    const key = lifecycle(rec.status);
    if (key !== undefined && type.lifecycle !== undefined) meta[type.lifecycle] = key;
  }
  if (rec.createdBy !== undefined && type.creator !== undefined) meta[type.creator] = rec.createdBy;
  if (rec.centroid !== undefined)
    problem('not_carried', 'the v3 centroid is not converted: v4 derives it from the geometry with core.geo');

  const converted = all.map((step, index): PreparedStep => {
    const values: Record<string, Json> = {};
    const refs: RefEntry[] = [];
    for (const row of step.rows) {
      if (row.system !== undefined) {
        if (row.system === 'geometry') {
          if (row === geometryRow) continue;
          const g =
            type.geometry !== undefined && isGeometry(row.value)
              ? prepareGeometry(env.geo, row.value, { sourceCrs: 'EPSG:4326' })
              : undefined;
          if (g === undefined || 'message' in g)
            problem('no_geometry', `the position at step ${index} cannot be stored`);
          else values[type.geometry as string] = g.geometry as unknown as Json;
        } else if (row.system === 'stage') {
          const key = type.stage?.options[String(row.value)];
          if (type.stage === undefined || key === undefined)
            problem('unknown_stage', `stage "${String(row.value)}" is not in the converted project`);
          else values[type.stage.property] = key;
        } else {
          const key = lifecycle(String(row.value));
          if (key !== undefined && type.lifecycle !== undefined) values[type.lifecycle] = key;
        }
        continue;
      }
      const p = type.properties[row.field as string];
      if (p === undefined) {
        problem('unknown_field', `field "${String(row.field)}" is not in the converted project`);
        continue;
      }
      if (p.type === 'file') {
        problem('not_carried', `field "${String(row.field)}": files are not in the export`);
        continue;
      }
      if (p.type === 'reference') {
        refs.push({
          property: p.property,
          ...(p.inverse !== undefined ? { inverse: p.inverse } : {}),
          targets: refIds(row.value),
        });
        continue;
      }
      const v = convertValue(p, row.value);
      if (v === undefined)
        problem(
          'no_counterpart',
          `value ${JSON.stringify(row.value)} of "${String(row.field)}" has no v4 counterpart`,
        );
      else values[p.property] = v;
    }
    return { index, time: step.time, observer: step.observer, values, refs };
  });

  const created = toInstant(rec.createdAt);
  if (rec.createdAt !== undefined && created === undefined)
    problem('bad_time', `createdAt "${rec.createdAt}" cannot be read`);
  const first = converted[0];
  // The first run is part of the creation when it happened at the same time.
  const merge = first !== undefined && (created === undefined || first.time === created);
  const createTime = created ?? first?.time;
  const createValues: Record<string, Json> = { ...meta };
  if (merge && first !== undefined) {
    for (const [k, v] of Object.entries(first.values))
      if (v !== null && k !== type.geometry) createValues[k] = v;
  }
  const geometry = isGeometry(firstGeometry) ? firstGeometry : undefined;
  if (type.geometry !== undefined && geometry === undefined) {
    problem('no_geometry', 'the instance has no position');
    return undefined;
  }
  const actor = (merge ? first?.observer : undefined) ?? rec.createdBy ?? 'v3';
  const rest = merge && first !== undefined ? converted.slice(1) : converted;
  // A merged first step keeps its references for the links phase.
  const steps =
    merge && first !== undefined && first.refs.length > 0 ? [{ ...first, values: {} }, ...rest] : rest;
  return { rec, type, tasks, actor, createTime, createValues, geometry, steps };
}

export { refIds };
