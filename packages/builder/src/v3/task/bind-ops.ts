/**
 * "Verknüpfte Objekte" of the Definition tab: a task's `bind` (docs/05: `bind: { area: self.flaeche }`) as Doc ops,
 * pure like the other task `ops` modules (R1). v3 had no binds (it used the parent implicitly,
 * `FormEditorView.svelte:486-499`); A5 linked fields (A-047) need them, so this is an engine-required setting
 * (A-053). Only relations of cardinality one and reference properties of the subject type are offered (the
 * shape the compile step accepts, the same reading as `form/bound.ts`).
 */
import type { TemplateFile } from '@ueberblick/core';
import type { Doc, Op } from '../../doc';
import { slugKey } from '../../lenses/data-model/ops';
import { clearOps, setOps } from '../../lenses/task/edit';
import { labelOf } from '../../shell/location';
import { yielded } from '../form/bound';
import { subjectTypeOf } from './step-ops';

const at = (task: string): string => `tasks.${task}`;

export interface BindCandidate {
  /** The relation or reference property of the subject type. */
  readonly relation: string;
  readonly expr: string;
  readonly target: string;
  readonly targetLabel: string;
  readonly label: string;
}

export interface BindRow {
  readonly name: string;
  readonly expr: string;
  /** The candidate this expression is, when it has the common `self.<relation>` shape. */
  readonly candidate: BindCandidate | undefined;
}

/** The one-relations (and reference properties) of the task's subject type, with the target type shown. */
export function bindCandidates(
  file: TemplateFile,
  task: string,
  fallback: string,
  locale: string,
): BindCandidate[] {
  const subject = subjectTypeOf(file, task, fallback);
  const def = file.types?.[subject];
  if (def === undefined) return [];
  const names = [...Object.keys(def.relations ?? {}), ...Object.keys(def.properties)];
  const out: BindCandidate[] = [];
  for (const relation of new Set(names)) {
    const expr = `self.${relation}`;
    const target = yielded(file, subject, expr);
    if (target === undefined || file.types?.[target] === undefined) continue;
    const own = def.relations?.[relation]?.label ?? def.properties[relation]?.label;
    out.push({
      relation,
      expr,
      target,
      targetLabel: labelOf(file.types[target]?.label, locale, target),
      label: labelOf(own, locale, relation),
    });
  }
  return out;
}

/** The declared binds, each matched to its candidate (undefined: an expression the list cannot say). */
export function bindRows(file: TemplateFile, task: string, fallback: string, locale: string): BindRow[] {
  const candidates = bindCandidates(file, task, fallback, locale);
  return Object.entries(file.tasks?.[task]?.bind ?? {}).map(([name, e]) => {
    const expr = String(e).trim();
    return { name, expr, candidate: candidates.find((c) => c.expr === expr) };
  });
}

/** The form keys (`<bind>.<property>`) that read or write the bound Objekt `name`. */
export function bindImpact(file: TemplateFile, task: string, name: string): string[] {
  return Object.keys(file.tasks?.[task]?.form ?? {}).filter((k) => k.startsWith(`${name}.`));
}

/** A free bind name made from `base` (a relation's key, or what the admin typed). */
export const freeBindName = (file: TemplateFile, task: string, base: string, own?: string): string =>
  slugKey(base, new Set(Object.keys(file.tasks?.[task]?.bind ?? {}).filter((k) => k !== own)));

/** Adds the bind `name` = `expr`; `bind` is made when the task has none. */
export function addBindOps(doc: Doc, task: string, name: string, expr: string): readonly Op[] {
  const t = doc.effective().tasks?.[task];
  if (t === undefined) return [];
  if (t.bind === undefined) return setOps(doc, `${at(task)}.bind`, { [name]: expr });
  return setOps(doc, `${at(task)}.bind.${name}`, expr);
}

/** Points the bind `name` at another relation; its form fields keep their key. */
export function setBindOps(doc: Doc, task: string, name: string, expr: string): readonly Op[] {
  return doc.effective().tasks?.[task]?.bind?.[name] === undefined
    ? []
    : setOps(doc, `${at(task)}.bind.${name}`, expr);
}

/**
 * Removes the bind `name` (the whole `bind` when it was the last). Refused (`undefined`) while form entries use
 * it: the caller shows `bindImpact` and the admin removes those fields first.
 */
export function removeBindOps(doc: Doc, task: string, name: string): readonly Op[] | undefined {
  const file = doc.effective();
  const bind = file.tasks?.[task]?.bind;
  if (bind?.[name] === undefined) return [];
  if (bindImpact(file, task, name).length > 0) return undefined;
  return Object.keys(bind).length === 1
    ? clearOps(doc, `${at(task)}.bind`)
    : clearOps(doc, `${at(task)}.bind.${name}`);
}

/**
 * Renames the bind `name` to `next`. Refused (`undefined`) while form entries use it (their keys carry the
 * name) or when `next` is taken; an unchanged or empty name changes nothing.
 */
export function renameBindOps(doc: Doc, task: string, name: string, next: string): readonly Op[] | undefined {
  const file = doc.effective();
  const bind = file.tasks?.[task]?.bind;
  const expr = bind?.[name];
  if (expr === undefined || next === name || next === '') return [];
  if (bind?.[next] !== undefined || bindImpact(file, task, name).length > 0) return undefined;
  return [...setOps(doc, `${at(task)}.bind.${next}`, expr), ...clearOps(doc, `${at(task)}.bind.${name}`)];
}
