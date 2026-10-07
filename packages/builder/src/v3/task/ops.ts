/**
 * The task pane's edits as Doc ops (WP-336), pure like the other builder `ops` modules (R1): the pane,
 * tests and an assistant (H4) write through the same functions. Every edit is `Doc.apply`; the pane runs
 * `planEdit` over the ops first, so an edit that would leave a new problem at the task never lands.
 * v3 wrote these through its task store (`TaskConfigSidebar.svelte`); here the file is the store.
 */
import { listAutos, processesOf, WHO_ADMIN, type TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { slugKey } from '../../lenses/data-model/ops';
import { cellOp } from '../../lenses/roles/ops';
import { clearOps, localizedText, setOnOps, setOps, setWhenOps, withLocalized } from '../../lenses/task/edit';
import { onView } from '../../lenses/task/model';
import { stageOf, withStage } from './when';

export { localizedText };

const at = (task: string): string => `tasks.${task}`;
const lang = (locale: string): string => locale.split('-')[0] ?? locale;

/** The task's label in `locale`; empty text changes nothing (the label is required). */
export function labelOps(doc: Doc, task: string, locale: string, text: string): readonly Op[] {
  if (text.trim() === '') return [];
  const value = withLocalized(doc.effective().tasks?.[task]?.label, locale, text);
  return value === undefined ? [] : setOps(doc, `${at(task)}.label`, value);
}

/** The task's description in `locale`; empty text removes the language, and the attribute when none is left. */
export function descriptionOps(doc: Doc, task: string, locale: string, text: string): readonly Op[] {
  const path = `${at(task)}.description`;
  const value = withLocalized(doc.effective().tasks?.[task]?.description, locale, text);
  if (value === undefined)
    return doc.effective().tasks?.[task]?.description === undefined ? [] : clearOps(doc, path);
  return setOps(doc, path, value);
}

/** "Einstiegs-Task": offered from a map position and creating `type`, or an ordinary task of `type` again. */
export function entryOps(doc: Doc, task: string, type: string, entry: boolean): readonly Op[] {
  if (entry) return [...setOps(doc, `${at(task)}.creates`, type), ...setOnOps(doc, task, '$map')];
  return [...setOnOps(doc, task, type), ...clearOps(doc, `${at(task)}.creates`)];
}

/** A task's `when` as text (empty: none). */
const whenOf = (doc: Doc, task: string): string | undefined => doc.effective().tasks?.[task]?.when;

/** The ops that keep `types.<type>.permissions.create` in line with the roles the task now names. */
function createAudienceOps(
  doc: Doc,
  type: string,
  before: readonly string[],
  now: readonly string[],
): readonly Op[] {
  const file = doc.effective();
  if (file.types?.[type] === undefined) return [];
  // No role left: nobody (a person) runs the task any more; the type's `create` audience is not widened for it.
  if (now.length === 0) return [];
  const edits = [
    ...now.filter((r) => !before.includes(r)).map((r) => ({ r, on: true })),
    ...before.filter((r) => !now.includes(r)).map((r) => ({ r, on: false })),
  ];
  const ops: Op[] = [];
  let cur = doc;
  for (const { r, on } of edits) {
    const op = cellOp(cur.effective(), { type, action: 'create', subject: `role:${r}`, on });
    if (op === undefined) continue;
    ops.push(op);
    cur = cur.apply(op).doc;
  }
  return ops;
}

/**
 * "Wer darf dies nutzen": the task's `who` (the roles whose people may run it, plus the reserved `admin`; none: no
 * person, C-004 step 3) and, for a task that creates, the type's `create` audience (A-009: the builder writes `who`
 * plus `create` until the rights follow from the tasks).
 */
export function rolesOps(doc: Doc, task: string, roles: readonly string[]): readonly Op[] {
  const t = doc.effective().tasks?.[task];
  if (t === undefined) return [];
  const path = `${at(task)}.who`;
  const ops: Op[] = [
    ...(roles.length === 0
      ? t.who === undefined
        ? []
        : clearOps(doc, path)
      : setOps(doc, path, [...roles])),
  ];
  if (t.creates !== undefined)
    ops.push(
      ...createAudienceOps(
        doc,
        t.creates,
        (t.who ?? []).filter((r) => r !== WHO_ADMIN),
        roles.filter((r) => r !== WHO_ADMIN),
      ),
    );
  return ops;
}

/** The type the task works on (the type it creates, else its first `on` type, else `fallback`) and its stage property. */
export function stageSourceOf(
  file: TemplateFile,
  task: string,
  fallback: string,
): { readonly type: string; readonly property: string } | undefined {
  const t = file.tasks?.[task];
  const on = t === undefined ? undefined : onView(t.on);
  const first = on?.kind === 'types' ? on.types[0] : undefined;
  for (const type of [first, t?.creates, fallback]) {
    const def = type === undefined ? undefined : file.types?.[type];
    const process = def === undefined ? undefined : processesOf(def)[0];
    if (type !== undefined && process !== undefined) return { type, property: process.property };
  }
  return undefined;
}

export const stagePropertyOf = (file: TemplateFile, task: string, fallback: string): string | undefined =>
  stageSourceOf(file, task, fallback)?.property;

/** Pins the task to one stage (`undefined`: offered in every stage). `undefined` result: not editable here. */
export function stageOps(
  doc: Doc,
  task: string,
  property: string,
  option: string | undefined,
): readonly Op[] | undefined {
  const when = withStage(whenOf(doc, task), property, option);
  return when === false ? undefined : setWhenOps(doc, task, when ?? '');
}

/** The Bedingungen rows replaced by `source` (empty: none). */
export const conditionOps = (doc: Doc, task: string, source: string): readonly Op[] =>
  setWhenOps(doc, task, source.trim());

export { stageOf };

/**
 * The ops that take `tasks` out of an overlay `order` of the task list: the file refuses to hide or remove a key
 * that an `order` still lists, and a reorder (the canvas' grip, WP-435) lists every task.
 */
export function cutTaskOrder(doc: Doc, tasks: readonly string[]): readonly Op[] {
  const listed = doc.overlay().order?.['tasks'];
  if (listed === undefined || !listed.some((k) => tasks.includes(k))) return [];
  return [{ kind: 'order', path: 'tasks', keys: listed.filter((k) => !tasks.includes(k)) }];
}

/** Takes the task out of the effective file; a task of the template is hidden. */
export const deleteOps = (doc: Doc, task: string): readonly Op[] => [
  ...cutTaskOrder(doc, [task]),
  ...clearOps(doc, at(task)),
];

/**
 * The automatic actions a delete of the task touches (v3's confirm dialog impact list): its own entries go with it,
 * and the ones that run `after` it are left without their trigger.
 */
export function dependentRules(file: TemplateFile, task: string): readonly string[] {
  return listAutos(file)
    .filter((a) => a.task === task || a.entry.after === task)
    .map((a) => a.id);
}

/** A role made in the picker (v3 `RoleSelect` `onCreateRole`): added to `roles`, live with the next deploy (Q6). */
export function createRoleOps(
  file: TemplateFile,
  locale: string,
  name: string,
): { readonly key: string; readonly ops: readonly Op[] } {
  const key = slugKey(name, new Set(Object.keys(file.roles ?? {})));
  const label = { [lang(locale)]: name.trim() };
  const op: Op =
    file.roles === undefined
      ? { kind: 'add', path: 'roles', value: { [key]: { label } } }
      : { kind: 'add', path: `roles.${key}`, value: { label } };
  return { key, ops: [op] };
}
