/**
 * Task edits as WP-200 ops. No DOM: the lens, tests and assistants (H4) share them (R1). Every edit is
 * `Doc.apply`; `planEdit` chains the ops one edit needs, and refuses (with the reason) instead of
 * doing nothing or leaving a new problem at the edited path.
 */
import { formatKeyPath, localizeExact, type Json, type LocalizedString } from '@ueberblick/core';
import type { Doc, Op, Refusal } from '../../doc';
import { labelOf } from '../../shell/location';
import type { StepView } from './model';

export type EditFailure =
  | {
      readonly ok: false;
      readonly reason: 'problem';
      readonly message: string;
      readonly hint?: string;
    }
  | { readonly ok: false; readonly reason: 'refused'; readonly message: string; readonly refusal: Refusal }
  | { readonly ok: false; readonly reason: 'no_effect' };

export type EditPlan = { readonly ok: true; readonly ops: readonly Op[]; readonly doc: Doc } | EditFailure;

const problemKey = (p: { code: string; path: string }): string => `${p.code} ${p.path}`;
const under = (path: string, scope: string): boolean =>
  path === scope || path.startsWith(`${scope}.`) || path.startsWith(`${scope}[`);

/**
 * Applies `ops` in order to `doc`. Fails when an op is refused, when the edit leaves a problem at
 * `scope` (a key path) that the document did not have before (core's checker, not ours), or when it
 * changes nothing. On success `ops` are what the shell must apply, in this order.
 */
export function planEdit(doc: Doc, ops: readonly Op[], scope: string, locale: string): EditPlan {
  const before = new Set(doc.problems().map(problemKey));
  const batch = doc.applyBatch(ops);
  if ('refused' in batch)
    return { ok: false, reason: 'refused', message: batch.refused.message, refusal: batch.refused };
  const cur = batch.doc;
  const problems = batch.problems;
  const fresh = problems.find((p) => under(p.path, scope) && !before.has(problemKey(p)));
  if (fresh !== undefined) {
    return {
      ok: false,
      reason: 'problem',
      message: labelOf(fresh.message, locale, fresh.code),
      ...(fresh.hint !== undefined ? { hint: fresh.hint } : {}),
    };
  }
  const same = cur === doc || JSON.stringify(cur.effective().tasks) === JSON.stringify(doc.effective().tasks);
  return same ? { ok: false, reason: 'no_effect' } : { ok: true, ops, doc: cur };
}

const taskAt = (task: string): string => `tasks.${task}`;
/** A form key may be `<bind>.<property>` (A-047): the path grammar quotes it. */
const fieldAt = (task: string, field: string): string => formatKeyPath(['tasks', task, 'form', field]);

/** True when the overlay hides `path` itself: a `set` there would be refused until it is unhidden. */
const hidden = (doc: Doc, path: string): boolean => doc.overlay().hide?.includes(path) === true;

/** `set` of `path`; an earlier `hide` of the same path is undone first. */
export function setOps(doc: Doc, path: string, value: unknown): readonly Op[] {
  return [...(hidden(doc, path) ? [{ kind: 'unhide', path } as const] : []), { kind: 'set', path, value }];
}

/**
 * Takes the entry at `path` out of the effective file: an entry the overlay added is reset; one the
 * template has is hidden (after undoing an override of it, so `hide` is the last word).
 */
export function clearOps(doc: Doc, path: string): readonly Op[] {
  if (hidden(doc, path)) return [];
  switch (doc.provenance(path)) {
    case 'added':
      return [{ kind: 'reset', path }];
    case 'changed':
      return [
        { kind: 'reset', path },
        { kind: 'hide', path },
      ];
    case 'template':
      return [{ kind: 'hide', path }];
  }
}

export const setOnOps = (doc: Doc, task: string, on: string | readonly string[]): readonly Op[] =>
  setOps(doc, `${taskAt(task)}.on`, on);

/** The task's `when`; an empty source removes it. */
export function setWhenOps(doc: Doc, task: string, source: string): readonly Op[] {
  const path = `${taskAt(task)}.when`;
  return source.trim() === '' ? clearOps(doc, path) : setOps(doc, path, source.trim());
}

/** A form field attribute (`required`, `relevant`, ...); `undefined` removes it. */
export function setFieldAttrOps(
  doc: Doc,
  task: string,
  field: string,
  attr: string,
  value: Json | undefined,
): readonly Op[] {
  const path = `${fieldAt(task, field)}.${attr}`;
  return value === undefined ? clearOps(doc, path) : setOps(doc, path, value);
}

export const addFieldOps = (doc: Doc, task: string, property: string): readonly Op[] =>
  setOps(doc, fieldAt(task, property), {});

export const removeFieldOps = (doc: Doc, task: string, field: string): readonly Op[] =>
  clearOps(doc, fieldAt(task, field));

/** The steps as the file has them (`set`, then `when` or `otherwise`). */
export type Step = {
  readonly set: { readonly [key: string]: Json };
  readonly when?: string;
  readonly otherwise?: true;
};

export const stepOf = (s: StepView): Step => ({
  set: Object.fromEntries(s.set.map((e) => [e.key, e.value])),
  ...(s.when !== undefined ? { when: s.when.source } : {}),
  ...(s.otherwise ? { otherwise: true as const } : {}),
});

/** The step without its condition and `otherwise`. */
export const unconditional = (s: Step): Step => ({ set: s.set });

/** The whole `then` list; a list is atomic in the overlay (A-005). An empty list removes `then`. */
export function setThenOps(doc: Doc, task: string, steps: readonly Step[]): readonly Op[] {
  const path = `${taskAt(task)}.then`;
  return steps.length === 0 ? clearOps(doc, path) : setOps(doc, path, steps);
}

/** A step moves one place up (`by` -1) or down (+1); the order is the order they run in. */
export function moveStep(steps: readonly Step[], index: number, by: -1 | 1): readonly Step[] {
  const to = index + by;
  const step = steps[index];
  if (step === undefined || to < 0 || to >= steps.length) return steps;
  const out = [...steps];
  out.splice(index, 1);
  out.splice(to, 0, step);
  return out;
}

export const removeStep = (steps: readonly Step[], index: number): readonly Step[] =>
  steps.filter((_, i) => i !== index);

export const replaceStep = (steps: readonly Step[], index: number, step: Step): readonly Step[] =>
  steps.map((s, i) => (i === index ? step : s));

/** The text of a `LocalizedString` in `locale` for editing: never another language (`localizeExact` of core). */
export function localizedText(v: unknown, locale: string): string {
  return v === null || (typeof v !== 'string' && typeof v !== 'object')
    ? ''
    : localizeExact(v as LocalizedString, locale);
}

/**
 * The value of a `LocalizedString` attribute after typing `text` in `locale`: a plain string stays a
 * plain string, a map keeps its other languages, empty text removes the language (`undefined` when
 * nothing is left).
 */
export function withLocalized(existing: unknown, locale: string, text: string): Json | undefined {
  const lang = locale.split('-')[0] ?? locale;
  const t = text.trim();
  if (typeof existing === 'string' || existing === undefined || existing === null) {
    return t === '' ? undefined : existing === undefined || existing === null ? { [lang]: t } : t;
  }
  const kept = Object.entries(existing as { readonly [l: string]: string }).filter(([l]) => l !== lang);
  const map = Object.fromEntries(t === '' ? kept : [...kept, [lang, t]]);
  return Object.keys(map).length === 0 ? undefined : map;
}

/** The `page` object of a field after typing `text` for its `label` or `hint` in `locale`; empty texts leave `{}` (the page stays). */
export function withPage(existing: unknown, locale: string, part: 'label' | 'hint', text: string): Json {
  const page = (typeof existing === 'object' && existing !== null ? existing : {}) as {
    readonly [k: string]: Json;
  };
  const next = withLocalized(page[part], locale, text);
  const rest = Object.fromEntries(Object.entries(page).filter(([k]) => k !== part));
  return next === undefined ? rest : { ...rest, [part]: next };
}
