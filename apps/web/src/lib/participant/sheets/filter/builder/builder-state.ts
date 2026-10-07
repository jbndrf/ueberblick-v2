/**
 * The state of the view builder's rows (WP-665, v3 `FilterBuilder.svelte:49-160`): which rows exist, what a freshly
 * added row holds, and how the field picker adds and removes rows. Pure; the rows are core's `Clause`.
 */
import type { BuilderContext, BuilderField, Clause } from '@ueberblick/core/filters';

/** What "Weitere Bedingung hinzufügen" offers (v3 `ClauseKind` without the property row). */
export const OTHER_KINDS = ['stage', 'created', 'changed', 'created_by'] as const;
export type OtherKind = (typeof OTHER_KINDS)[number];

/** The picker's id of a field: v3 `fieldKey` (workflow and field). */
export const fieldId = (f: { readonly type: string; readonly key: string }): string => `${f.type}|${f.key}`;

/** A fresh row for a field, with the editor the field's type needs (v3 `defaultFieldClause`). */
export function defaultClause(f: BuilderField): Clause {
  const base = { kind: 'field' as const, type: f.type, key: f.key, propType: f.propType };
  switch (f.editor) {
    case 'text':
      return { ...base, editor: 'text', text: '' };
    case 'number':
      return { ...base, editor: 'number', min: null, max: null };
    case 'date':
      return { ...base, editor: 'date', from: null, to: null };
    case 'choice':
      return { ...base, editor: 'choice', values: [] };
    case 'boolean':
      return { ...base, editor: 'boolean', value: null };
    case 'time':
      return { ...base, editor: 'time', from: null, to: null };
    case 'participant':
      return { ...base, editor: 'participant', me: false };
    case 'presence':
      return { ...base, editor: 'presence', state: null };
  }
}

/** The ids of the fields that have a row. */
export const pickedIds = (clauses: readonly Clause[]): readonly string[] =>
  clauses.flatMap((c) => (c.kind === 'field' ? [fieldId(c)] : []));

/**
 * The rows after the picker changed to `next`: rows of unpicked fields go, rows of newly picked fields are added at
 * the end, every other row stays (v3 `handleFieldPickerChange`). Returns the same list when nothing changed.
 */
export function pickFields(
  clauses: readonly Clause[],
  ctx: BuilderContext,
  next: readonly string[],
): readonly Clause[] {
  const now = new Set(pickedIds(clauses));
  const want = new Set(next);
  if (want.size === now.size && [...want].every((id) => now.has(id))) return clauses;
  const kept = clauses.filter((c) => c.kind !== 'field' || want.has(fieldId(c)));
  const added = next.flatMap((id) => {
    const f = now.has(id) ? undefined : ctx.fields.find((x) => fieldId(x) === id);
    return f === undefined ? [] : [defaultClause(f)];
  });
  return [...kept, ...added];
}

/** A fresh "other" row (v3 `addOtherClause`): the first Objektart with stages, "older than 7 days", no creators. */
export function otherClause(kind: OtherKind, ctx: BuilderContext): Clause | undefined {
  switch (kind) {
    case 'stage': {
      const first = ctx.stages[0];
      return first === undefined ? undefined : { kind: 'stage', type: first.type, values: [] };
    }
    case 'created':
    case 'changed':
      return { kind: 'when', field: kind, mode: 'older', days: 7, from: null, to: null };
    case 'created_by':
      return { kind: 'created_by', values: [] };
  }
}

/** The "other" kinds the menu offers: no stage entry when no Objektart has a process. */
export const otherKinds = (ctx: BuilderContext): readonly OtherKind[] =>
  ctx.stages.length === 0 ? OTHER_KINDS.filter((k) => k !== 'stage') : OTHER_KINDS;

export const replaceAt = (clauses: readonly Clause[], i: number, next: Clause): readonly Clause[] =>
  clauses.map((c, j) => (j === i ? next : c));
export const removeAt = (clauses: readonly Clause[], i: number): readonly Clause[] =>
  clauses.filter((_, j) => j !== i);
