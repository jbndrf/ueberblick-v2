/**
 * "Nur eigene" (v3 `TaskConfigSidebar.svelte:355-361`, `ownership: 'self'`): the task is offered only on
 * objects the actor created. In v4 it is one conjunct of the task's `when` (R5; docs/06 system fields):
 * `self.$created_by == actor.id`. It is a conjunct like the role clause, so the Bedingungen rows, the roles and
 * this switch are three views of one expression (`when.ts`, R1). Pure text in, text out.
 */
import type { Expr } from '@ueberblick/core/expr/compile';
import type { Doc, Op } from '../../doc';
import { setWhenOps } from '../../lenses/task/edit';
import { conditionOps } from './ops';
import { bin, compose, leavesOf, type Leaf } from './when';

export const OWN_CLAUSE = 'self.$created_by == actor.id';

const isCreator = (e: Expr): boolean =>
  e.kind === 'member' && e.field === '$created_by' && e.object.kind === 'ident' && e.object.name === 'self';
const isActorId = (e: Expr): boolean =>
  e.kind === 'member' && e.field === 'id' && e.object.kind === 'ident' && e.object.name === 'actor';

/** True when the leaf says "created by the actor", either way round. */
function isOwn(l: Leaf): boolean {
  const eq = bin(l.ast, '==');
  return (
    eq !== undefined &&
    ((isCreator(eq.left) && isActorId(eq.right)) || (isActorId(eq.left) && isCreator(eq.right)))
  );
}

/** False when the condition does not parse: the switch is then off and the text is edited in the YAML. */
export const ownEditable = (source: string | undefined): boolean => leavesOf(source) !== undefined;

export function isOnlyOwn(source: string | undefined): boolean {
  return (leavesOf(source) ?? []).some(isOwn);
}

/** The condition without the clause (undefined: nothing is left). */
export function withoutOwn(source: string | undefined): string | undefined {
  const leaves = leavesOf(source);
  if (leaves === undefined) return source;
  return compose(leaves.filter((l) => !isOwn(l)).map((l) => l.src));
}

/** The condition with the clause on or off; a condition that does not parse comes back unchanged. */
export function withOwn(source: string | undefined, own: boolean): string | undefined {
  const leaves = leavesOf(source);
  if (leaves === undefined) return source;
  const others = leaves.filter((l) => !isOwn(l)).map((l) => l.src);
  return compose(own ? [OWN_CLAUSE, ...others] : others);
}

const whenOf = (doc: Doc, task: string): string | undefined => doc.effective().tasks?.[task]?.when;

/** "Nur eigene" switched on or off; the roles and the rows stay. */
export const ownOps = (doc: Doc, task: string, own: boolean): readonly Op[] =>
  setWhenOps(doc, task, withOwn(whenOf(doc, task), own) ?? '');

/** The Bedingungen rows replaced by `source`; "Nur eigene" is not a row and stays as it is. */
export const rowsOps = (doc: Doc, task: string, source: string): readonly Op[] =>
  conditionOps(doc, task, isOnlyOwn(whenOf(doc, task)) ? (withOwn(source, true) ?? '') : source);
