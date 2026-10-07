/**
 * The ⋮ menu's three edits of the data page (WP-419, S3-19; v3 `W/+page.server.ts:488-537`) as pure builder functions:
 * duplicate and import copy an Objektart with what belongs to it (`copy.ts`), delete removes it. Every result is a list
 * of overlay ops for the draft (a template-owned entry is hidden, an added one dropped: `removeOp`), so the publish bar
 * and the deploy overview (WP-360) carry the deletion to the data; nothing is deleted here (R3).
 */
import {
  autoPath,
  splitAutoId,
  type KeyPath,
  type LocalizedString,
  type Problem,
  type TemplateFile,
} from '@ueberblick/core';
import { applyOps, type Doc, type Op } from '../../../doc';
import { removeOp } from '../../../lenses/data-model/ops';
import { copyLabel, copyTypeOps, freshTypeKey, type TypeCopy } from './copy';
import { relatedTo } from './related';

/** The language the label of a copy is made in when the type has no label of its own (the page language). */
export function duplicateTypeOps(file: TemplateFile, type: string, lang: string): TypeCopy {
  const key = freshTypeKey(file, type);
  return copyTypeOps(file, type, file, key, copyLabel(file.types?.[type]?.label, lang, type), 'duplicate');
}

/** The copy of `type` of another project's file, for this project's file (`target`): a fresh key, permissions reset. */
export function importTypeOps(
  source: TemplateFile,
  type: string,
  target: TemplateFile,
  lang: string,
): TypeCopy {
  const key = freshTypeKey(target, type);
  const label: LocalizedString = copyLabel(source.types?.[type]?.label, lang, type);
  return copyTypeOps(source, type, target, key, label, 'import');
}

const path = (section: string, key: string): KeyPath => `${section}.${key}` as KeyPath;

/**
 * The ops that remove `type` and what belongs to it: its tasks (a task offered on other types as well only loses this
 * one), the automatic actions that run after those (the ones on those tasks go with them), its views, and the role apps' entries for the removed views and tasks.
 * Anything else that still names the type (a relation of another type, a reference property) is left to the problems
 * list: `removeType` reports it, the admin fixes it in the builder.
 */
export function removeTypeOps(doc: Doc, type: string): readonly Op[] {
  const file = doc.effective();
  if (file.types?.[type] === undefined) return [];
  const rel = relatedTo(file, type);
  const ops: Op[] = [removeOp(doc, path('types', type))];
  const goneTasks = new Set<string>();
  for (const k of rel.tasks) {
    const task = file.tasks?.[k];
    if (task === undefined) continue;
    const others = Array.isArray(task.on) ? task.on.filter((t) => t !== type) : [];
    if (task.creates !== type && others.length > 0) {
      ops.push({ kind: 'set', path: path('tasks', `${k}.on`), value: others });
    } else {
      goneTasks.add(k);
      ops.push(removeOp(doc, path('tasks', k)));
    }
  }
  for (const id of rel.rules) {
    const { task, name } = splitAutoId(id);
    const after = file.tasks?.[task]?.auto?.[name]?.after;
    if (!goneTasks.has(task) && after !== undefined && goneTasks.has(after))
      ops.push(removeOp(doc, autoPath({ task, name })));
  }
  const goneViews = new Set(rel.views);
  for (const k of rel.views) ops.push(removeOp(doc, path('views', k)));
  for (const [role, def] of Object.entries(file.roles ?? {})) {
    for (const v of Object.keys(def.app?.views ?? {}))
      if (goneViews.has(v)) ops.push(removeOp(doc, path('roles', `${role}.app.views.${v}`)));
    for (const t of Object.keys(def.app?.shortcuts ?? {}))
      if (goneTasks.has(t)) ops.push(removeOp(doc, path('roles', `${role}.app.shortcuts.${t}`)));
  }
  return ops;
}

export type RemoveResult =
  | { readonly ok: true; readonly doc: Doc; readonly dangling: readonly Problem[] }
  | { readonly ok: false; readonly detail: string };

const problemKey = (p: Problem): string => `${p.code}|${p.path}|${JSON.stringify(p.message)}`;

/**
 * `removeTypeOps` applied: the Doc without the type, and the problems that the removal leaves in the file (a relation or
 * reference of another type that pointed here). They are reported, not repaired: the admin decides what replaces them.
 */
export function removeType(doc: Doc, type: string): RemoveResult {
  const ops = removeTypeOps(doc, type);
  if (ops.length === 0) return { ok: false, detail: `no type ${type}` };
  const before = new Set(doc.problems().map(problemKey));
  const r = applyOps(doc, ops);
  if ('refused' in r) return { ok: false, detail: r.refused.message };
  return { ok: true, doc: r.doc, dangling: r.problems.filter((p) => !before.has(problemKey(p))) };
}
