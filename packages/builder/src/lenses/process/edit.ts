/**
 * Edits of the process lens as document ops (WP-200): an arrow is a `then` step of a task, so
 * drawing one writes `tasks.<key>.then` (a list is atomic, A-005) or adds a task. Pure functions of
 * the effective file, so the drag, the keyboard path and an assistant (H4) all end up in the same ops.
 */
import { formatKeyPath, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { clearOps } from '../task/edit';
import {
  EDGE_ORIGINS,
  literalOption,
  pinnedOptions,
  taskOfferedOn,
  type ProcessEdge,
  type TaskDef,
} from './graph';

export const CONNECT_REFUSALS = {
  /** An arrow with this task, source and target already exists. */
  exists: 'exists',
  /** The task's own `when` fixes a different source state. */
  taskPinned: 'task_pinned',
  unknownTask: 'unknown_task',
} as const;
export type ConnectRefusal = (typeof CONNECT_REFUSALS)[keyof typeof CONNECT_REFUSALS];

export type EditResult =
  | { readonly ok: true; readonly ops: readonly Op[] }
  | { readonly ok: false; readonly reason: ConnectRefusal };

type Step = NonNullable<TaskDef['then']>[number];

/** Which task carries the new arrow: an existing one, or a new one with a name. */
export type Carrier =
  { readonly task: string } | { readonly newTask: { readonly name: string; readonly lang: string } };

export interface Connect {
  readonly type: string;
  readonly property: string;
  /** Source option; undefined: from any state. */
  readonly from?: string;
  readonly to: string;
  readonly carrier: Carrier;
}

const quote = (option: string): string => `'${option}'`;

/** The lens writes an emptied `then` as `[]`; the file never keeps an empty list: that op becomes a removal. */
export function noEmptyThen(doc: Doc, op: Op): readonly Op[] {
  return op.kind === 'set' && Array.isArray(op.value) && op.value.length === 0 && op.path.endsWith('.then')
    ? clearOps(doc, op.path)
    : [op];
}
const pinFor = (property: string, option: string): string => `self.${property} == ${quote(option)}`;
const thenPath = (task: string): string => formatKeyPath(['tasks', task, 'then']);

/** A task key from a name: `^[a-z][a-z0-9_]*$`, not yet used. */
export function newTaskKey(file: TemplateFile, name: string): string {
  const slug = name
    .replace(/[äÄ]/g, 'ae')
    .replace(/[öÖ]/g, 'oe')
    .replace(/[üÜ]/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = /^[a-z]/.test(slug) ? slug : `aufgabe_${slug}`.replace(/_$/, '');
  const taken = new Set(Object.keys(file.tasks ?? {}));
  let key = base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
  return key;
}

/** The op(s) that draw an arrow. */
export function connectOps(file: TemplateFile, c: Connect): EditResult {
  if ('newTask' in c.carrier) {
    const { name, lang } = c.carrier.newTask;
    const step: Step = { set: { [c.property]: quote(c.to) } };
    const value = {
      label: { [lang]: name },
      on: c.type,
      ...(c.from !== undefined ? { when: pinFor(c.property, c.from) } : {}),
      then: [step],
    };
    return {
      ok: true,
      ops: [{ kind: 'add', path: formatKeyPath(['tasks', newTaskKey(file, name)]), value }],
    };
  }
  const key = c.carrier.task;
  const task = file.tasks?.[key];
  if (task === undefined) return { ok: false, reason: CONNECT_REFUSALS.unknownTask };
  const taskFrom = taskOfferedOn(task, c.type) ? pinnedOptions(task.when, c.property) : undefined;
  const then = task.then ?? [];
  if (taskFrom !== undefined && (c.from === undefined || !taskFrom.includes(c.from))) {
    return { ok: false, reason: CONNECT_REFUSALS.taskPinned };
  }
  const exists = then.some(
    (s) =>
      s.of === undefined &&
      literalOption(s.set?.[c.property]) === c.to &&
      (c.from === undefined ? s.when === undefined : pinnedOptions(s.when, c.property)?.includes(c.from)),
  );
  if (exists) return { ok: false, reason: CONNECT_REFUSALS.exists };
  const fixedByTask = taskFrom !== undefined;
  const step: Step = {
    set: { [c.property]: quote(c.to) },
    ...(c.from !== undefined && !fixedByTask ? { when: pinFor(c.property, c.from) } : {}),
  };
  // `Doc.apply` writes this `set` as an `add` when the task has no `then` yet.
  return { ok: true, ops: [{ kind: 'set', path: thenPath(key), value: [...then, step] }] };
}

function stepsOf(file: TemplateFile, edge: ProcessEdge): readonly Step[] | undefined {
  return edge.origin === EDGE_ORIGINS.task && edge.step !== undefined
    ? file.tasks?.[edge.key]?.then
    : undefined;
}

/** Points a task arrow at another option. */
export function retargetOps(file: TemplateFile, edge: ProcessEdge, property: string, to: string): EditResult {
  const steps = stepsOf(file, edge);
  const at = edge.step;
  if (steps === undefined || at === undefined || steps[at] === undefined) {
    return { ok: false, reason: CONNECT_REFUSALS.unknownTask };
  }
  const next = steps.map((s, i) => (i === at ? { ...s, set: { ...s.set, [property]: quote(to) } } : s));
  return { ok: true, ops: [{ kind: 'set', path: thenPath(edge.key), value: next }] };
}

/** Removes a task arrow: the property leaves the step, and an empty step goes. */
export function removeOps(file: TemplateFile, edge: ProcessEdge, property: string): EditResult {
  const steps = stepsOf(file, edge);
  const at = edge.step;
  if (steps === undefined || at === undefined || steps[at] === undefined) {
    return { ok: false, reason: CONNECT_REFUSALS.unknownTask };
  }
  const next = steps.flatMap((s, i) => {
    if (i !== at) return [s];
    const rest = Object.fromEntries(Object.entries(s.set ?? {}).filter(([key]) => key !== property));
    return Object.keys(rest).length === 0 ? [] : [{ ...s, set: rest }];
  });
  return { ok: true, ops: [{ kind: 'set', path: thenPath(edge.key), value: next }] };
}
