/**
 * Why a difference exists: the approximated or dropped conversion report items that can have caused it. Which
 * items count depends on what differs, so an explanation names the few items that fit, not the whole task:
 *
 * - a refusal for a condition (`not_available`): the task's conditions and activation
 * - a refusal for a property the actor may not write or see: the field's items
 * - any other refusal (the form): the task's steps and the items of the fields that the run touches
 * - a differing value or stage: the field's items, the task's effects and the workflow's rule sets
 *
 * Layout-only notes (a field's page, row and column, a button's look) never explain a behavioural difference.
 */
import type { ConvertResult } from '../config/convert';
import { K } from '../config/read-parts';
import type { Found } from './compare';
import type { Difference, V3Run } from './types';

const LAYOUT_ONLY = /\.tools\.\d+\.fields\.\d+$|\.visual$/;

const fieldKeys = (run: V3Run): string[] => [
  ...new Set([
    ...Object.keys(run.input ?? {}),
    ...Object.keys(run.instance?.values ?? {}),
    ...Object.keys(run.recorded.values ?? {}),
  ]),
];

/** The v3 field keys whose v4 property is named in `text` (a refusal message like "may not write baum.hoehe_m"). */
function namedFields(run: V3Run, converted: ConvertResult, text: string): string[] {
  const type = converted.mapping.types[run.workflow] ?? converted.mapping.tables[run.workflow];
  if (type === undefined) return [];
  return Object.entries(type.properties)
    .filter(([, p]) => new RegExp(`(^|[^a-z0-9_])${p.property}([^a-z0-9_]|$)`).test(text))
    .map(([field]) => field);
}

/** The item id prefixes that can explain `f`. */
function prefixes(f: Found, run: V3Run, converted: ConvertResult): string[] {
  const wf = `workflows.${run.workflow}`;
  const task = `${wf}.tasks.${run.task}`;
  const field = (k: string): string => `${wf}.${K.props}.${k}`;
  if (f.kind === 'value') return [`${task}.effects`, `${wf}.${K.rules}`, field(f.detail)];
  if (f.kind === 'stage') return [`${task}.effects`, `${wf}.${K.rules}`];
  if (f.code === 'not_available') return [`${task}.conditions`, `${task}.activation`];
  if (f.code === 'not_permitted') {
    const named = namedFields(run, converted, f.detail);
    return (named.length > 0 ? named : fieldKeys(run)).map(field);
  }
  if (f.code !== undefined) return [`${task}.tools`, ...fieldKeys(run).map(field)];
  // v4 accepted what v3 refused: the conditions that v4 dropped or widened
  return [`${task}.conditions`, `${task}.activation`, ...fieldKeys(run).map(field)];
}

/** The report items that can explain a difference of `run`. */
export function relevantItems(
  f: Found,
  run: V3Run,
  converted: ConvertResult,
): { id: string; reason: string }[] {
  const ps = prefixes(f, run, converted);
  return converted.report.items
    .filter((i) => i.status !== 'mapped')
    .filter((i) => ps.some((p) => i.id === p || i.id.startsWith(`${p}.`)))
    .filter((i) => !(i.status === 'approximated' && LAYOUT_ONLY.test(i.id)))
    .map((i) => ({ id: i.id, reason: i.reason }));
}

/** Complete a found difference with its cause. */
export function explain(f: Found & { runId: string }, run: V3Run, converted: ConvertResult): Difference {
  const shown = { runId: f.runId, kind: f.kind, v3: f.v3, v4: f.v4 };
  if (run.recorded.known !== undefined) {
    return { ...shown, cause: 'known', reason: `${f.detail}; ${run.recorded.known}`, items: [] };
  }
  const items = relevantItems(f, run, converted);
  if (items.length === 0) {
    return { ...shown, cause: 'unexplained', reason: `${f.detail}; no report item explains it`, items: [] };
  }
  return {
    ...shown,
    cause: 'reported',
    reason: `${f.detail}; ${items.map((i) => i.reason).join('; ')}`,
    items: items.map((i) => i.id),
  };
}
