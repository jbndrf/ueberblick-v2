/**
 * The key paths of the elements the builder shows as nodes or panes (a task, an automatic action with the task only it runs, a
 * stage), so the action pane and every canvas node read provenance, reset and hide from the same paths (R1, WP-454).
 */
import { formatKeyPath, processesOf, type KeyPath } from '@ueberblick/core';
import type { Doc } from '../../doc';
import { autoAt, autoOf, ownsTask } from '../rule/auto-task';

export const ELEMENT_KINDS = { task: 'task', rule: 'rule', stage: 'stage' } as const;
export type ElementKind = (typeof ELEMENT_KINDS)[keyof typeof ELEMENT_KINDS];
export interface ElementRef {
  readonly kind: ElementKind;
  readonly key: string;
}

/** A stage is an option of the type's process property (A-028). */
export function stagePath(doc: Doc, type: string, stage: string): KeyPath | undefined {
  const t = doc.effective().types?.[type];
  const p = t === undefined ? undefined : processesOf(t)[0];
  return p === undefined
    ? undefined
    : formatKeyPath(['types', type, 'properties', p.property, 'options', stage]);
}

/** The paths an element is made of: an automatic action with its own task is both, as deleting it deletes both. */
export function elementPaths(doc: Doc, type: string, ref: ElementRef): readonly KeyPath[] {
  if (ref.kind === ELEMENT_KINDS.task) return [`tasks.${ref.key}`];
  if (ref.kind === ELEMENT_KINDS.stage) {
    const p = stagePath(doc, type, ref.key);
    return p === undefined ? [] : [p];
  }
  const file = doc.effective();
  const run = autoOf(file, ref.key)?.task;
  return [autoAt(ref.key), ...(run !== undefined && ownsTask(file, ref.key) ? [`tasks.${run}`] : [])];
}
