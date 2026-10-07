/**
 * The relation options of v3's Beziehungen dialog as visible config (WP-371, owner A2): "Anbindung" and "Wenn das
 * Eltern-Element gelöscht wird". Nothing here is an engine setting. What the admin picks is written as ordinary tasks
 * and steps, under keys that come from the relation, so saving again rewrites the same entries (never duplicates):
 *
 * - Anbindung: the child's creating task `rel_<parent>_<relation>_create` (`on: <parent>`, `creates: <child>`, the new
 *   child gets the parent in its reference) for both values, and `required` on the child's reference for "Verbindlich"
 *   (a child cannot be created without a parent), none for "Optional".
 * - mitlöschen: `{ lifecycle: deleted, of: self.<relation> }` before the parent's own delete step.
 * - trennen: `{ set: { <reference>: null }, of: self.<relation> }`.
 * - blockieren: `self.<relation>.size() == 0` among the `&&` operands of the delete task's `when`.
 *
 * The parent's delete task is a task offered on the parent with no `creates` that has a `lifecycle: deleted` step of
 * its own (A-028). Pure functions of a file; the ops that write them are in `option-ops.ts`.
 */
import {
  defineRegistry,
  type KeyOf,
  type LocalizedString,
  type RelationCardinality,
  type TemplateFile,
} from '@ueberblick/core';
import { taskOfferedOn } from '../../lenses/process/graph';

export const RELATION_ATTACHMENTS = defineRegistry([
  {
    key: 'enforced',
    description: "Verbindlich: a child is only created from its parent (the child's reference is required).",
  },
  { key: 'optional', description: 'Optional: a child can also be created alone and linked later.' },
] as const);
export type RelationAttachment = KeyOf<typeof RELATION_ATTACHMENTS>;

export const ON_DELETE_BEHAVIORS = defineRegistry([
  { key: 'cascade', description: "Kinder mitlöschen: the parent's delete also deletes its children." },
  { key: 'nullify', description: 'Kinder trennen: the children stay and lose their parent.' },
  { key: 'block', description: 'Löschen blockieren: the parent cannot be deleted while it has children.' },
] as const);
export type OnDeleteBehavior = KeyOf<typeof ON_DELETE_BEHAVIORS>;

/** v3's defaults of a new relation (`relations/+page.svelte:120-125`: enforced, nullify). */
export const RELATION_DEFAULTS: RelationOptions = { attachment: 'enforced', onDelete: 'nullify' };

/**
 * v3's 'Geometrie beim Erstellen' (`SPAWN_GEOMETRY_MODES`, WP-396). It is not stored as such: `inherit` is
 * `inherit_position: true` on the parent's relation, `draw` is a child type with a primary geometry of its own, `none`
 * is a child type with none and no `inherit_position`. Reading back is unambiguous; nothing here adds or removes a
 * geometry property (that stays in Felder).
 */
export const RELATION_GEOMETRIES = defineRegistry([
  { key: 'inherit', description: 'übernehmen: the children are drawn at the parent (`inherit_position`).' },
  { key: 'draw', description: 'zeichnen: the child type has a position of its own, drawn on creation.' },
  { key: 'none', description: 'keine: the child has no position (no geometry, not drawn at the parent).' },
] as const);
export type RelationGeometry = KeyOf<typeof RELATION_GEOMETRIES>;

/** v3's default of a new relation (`relations/+page.svelte:121`). */
export const DEFAULT_GEOMETRY: RelationGeometry = 'inherit';

export interface RelationOptions {
  readonly attachment: RelationAttachment;
  readonly onDelete: OnDeleteBehavior;
}

/** The parts of a relation the generated entries are named and shaped from. */
export interface RelationRef {
  readonly parent: string;
  readonly key: string;
  readonly child: string;
  readonly refKey: string;
  readonly cardinality: RelationCardinality;
}

type Tasks = NonNullable<TemplateFile['tasks']>;
export type TaskDef = Tasks[string];
export type ThenStep = NonNullable<TaskDef['then']>[number];

/**
 * The child's creating task of a relation. Keys have no separator beyond `_`, so `rel_<parent>_<key>` alone would
 * read the same for parent `a_b` with relation `c` and parent `a` with relation `b_c`. The parent's length in front
 * says where it ends, so two relations never share a key (a key starts with a letter, so no delete task key
 * `rel_<parent>_delete` looks like one either).
 */
export const createTaskKey = (r: Pick<RelationRef, 'parent' | 'key'>): string =>
  `rel_${r.parent.length}_${r.parent}_${r.key}_create`;

/** True when `task` can be the creating task of `r`: the one the options write (or one the admin shaped like it). */
export const isCreateTaskOf = (task: TaskDef, r: RelationRef): boolean =>
  task.on === r.parent && task.creates === r.child;

/** The delete task the options create when the parent has none (shared by the parent's relations). */
export const deleteTaskKey = (parent: string): string => `rel_${parent}_delete`;

/** Task labels in both builder languages, named from the relation (v3 `relationNavCreateChild`: "{name} anlegen"). */
export const createTaskLabel = (name: string): LocalizedString => ({
  de: `${name} anlegen`,
  en: `Create ${name}`,
});
export const DELETE_TASK_LABEL: LocalizedString = { de: 'Löschen', en: 'Delete' };

export const cascadeStep = (r: RelationRef): ThenStep => ({ lifecycle: 'deleted', of: `self.${r.key}` });
export const detachStep = (r: RelationRef): ThenStep => ({
  set: { [r.refKey]: null },
  of: `self.${r.key}`,
});
/** The `when` operand that refuses the delete while children exist; a `one` relation is a feature, not a list. */
export const blockTerm = (r: Pick<RelationRef, 'key' | 'cardinality'>): string =>
  r.cardinality === 'one' ? `self.${r.key} == null` : `self.${r.key}.size() == 0`;
/** Both spellings, so a relation whose multiplicity changed still finds its old operand. */
const blockTerms = (r: Pick<RelationRef, 'key'>): readonly string[] => [
  `self.${r.key}.size() == 0`,
  `self.${r.key} == null`,
];

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
export const isCascadeStep = (s: ThenStep, r: RelationRef): boolean => same(s, cascadeStep(r));
export const isDetachStep = (s: ThenStep, r: RelationRef): boolean => same(s, detachStep(r));
/** True for either generated step of the relation, whatever the old reference key was. */
export const isOptionStep = (s: ThenStep, r: Pick<RelationRef, 'key'>): boolean =>
  s.of === `self.${r.key}` &&
  s.when === undefined &&
  s.otherwise === undefined &&
  (s.lifecycle === 'deleted' || (s.set !== undefined && Object.values(s.set).every((v) => v === null)));

/** The operands of an expression joined by a top-level `&&`; a top-level `||` makes the whole expression one operand. */
export function conjuncts(src: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let from = 0;
  let orAtTop = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] as string;
    if (quote !== undefined) {
      if (c === '\\') i++;
      else if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && src.startsWith('||', i)) orAtTop = true;
    else if (depth === 0 && src.startsWith('&&', i)) {
      parts.push(src.slice(from, i).trim());
      from = i + 2;
      i++;
    } else if (depth === 0 && c === '?') orAtTop = true;
  }
  parts.push(src.slice(from).trim());
  return orAtTop ? [src.trim()] : parts.filter((p) => p !== '');
}

/** `p` without anything inside brackets or quotes, to test for a top-level `||` or `?`. */
function topLevel(p: string): string {
  let depth = 0;
  let quote: string | undefined;
  let out = '';
  for (const c of p) {
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
    } else if (c === "'" || c === '"') quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0) out += c;
  }
  return out;
}

const wrap = (p: string): string => (/\|\||\?/.test(topLevel(p)) ? `(${p})` : p);

/** `src` with the relation's blocking operand removed; `undefined` when nothing else is left. */
export function withoutBlock(src: string | undefined, r: Pick<RelationRef, 'key'>): string | undefined {
  if (src === undefined) return undefined;
  const drop = new Set(blockTerms(r));
  const rest = conjuncts(src).filter((p) => !drop.has(p));
  return rest.length === 0 ? undefined : rest.join(' && ');
}

/** `src` with the relation's blocking operand as the last `&&` operand (once). */
export function withBlock(src: string | undefined, r: RelationRef): string {
  const rest = withoutBlock(src, r);
  return rest === undefined ? blockTerm(r) : `${wrap(rest)} && ${blockTerm(r)}`;
}

export const hasBlock = (src: string | undefined, r: Pick<RelationRef, 'key'>): boolean =>
  src !== undefined && conjuncts(src).some((p) => blockTerms(r).includes(p));

/** A task's own delete step: `lifecycle: deleted` with no `of` (the relation steps before it have one). */
const ownDelete = (s: ThenStep): boolean => s.lifecycle === 'deleted' && s.of === undefined;

/** The parent's delete tasks (key and definition): offered on it, creating nothing, deleting its subject. */
export function deleteTasksOf(
  file: TemplateFile,
  parent: string,
): readonly { readonly key: string; readonly task: TaskDef }[] {
  return Object.entries(file.tasks ?? {})
    .filter(([, t]) => t.creates === undefined && taskOfferedOn(t, parent) && (t.then ?? []).some(ownDelete))
    .map(([key, task]) => ({ key, task }));
}

/** What the file says about the relation's options. */
export function readOptions(file: TemplateFile, r: RelationRef): RelationOptions {
  const reference = file.types?.[r.child]?.properties[r.refKey];
  const tasks = deleteTasksOf(file, r.parent);
  const onDelete: OnDeleteBehavior = tasks.some((t) => hasBlock(t.task.when, r))
    ? 'block'
    : tasks.some((t) => (t.task.then ?? []).some((s) => isCascadeStep(s, r)))
      ? 'cascade'
      : 'nullify';
  return { attachment: reference?.required === true ? 'enforced' : 'optional', onDelete };
}
