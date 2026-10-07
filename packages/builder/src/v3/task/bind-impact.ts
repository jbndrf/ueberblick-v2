/**
 * What a refused remove or rename of a bind would leave dangling (digest item 26). v3 opened a confirm with the
 * dependents listed when a field or relation was deleted (`workflow-builder/components/deletion.ts`:
 * `Dependents`, `formatDependents`). v4 keeps the refusal while form entries use the bind, and the dialog lists
 * the form entries and the expressions (`then`, `when`, `relevant` ...) that the checker reports once the bind is
 * gone. Pure: the checker's own problems, not a second reading of the expressions (R1).
 */
import { formatKeyPath } from '@ueberblick/core';
import type { Doc } from '../../doc';
import { clearOps } from '../../lenses/task/edit';
import { labelOf } from '../../shell/location';
import { bindImpact } from './bind-ops';

export interface BindImpact {
  /** Form entries `<bind>.<property>` that read or write the bound Objekt. */
  readonly fields: readonly string[];
  /** The checker's words for each expression that stops working, with its place in the file. */
  readonly expressions: readonly string[];
}

const problemKey = (p: { code: string; path: string }): string => `${p.code} ${p.path}`;

export function bindImpactOf(doc: Doc, task: string, name: string, locale: string): BindImpact {
  const file = doc.effective();
  const fields = bindImpact(file, task, name);
  const scope = formatKeyPath(['tasks', task]);
  const formEntries = fields.map((k) => formatKeyPath(['tasks', task, 'form', k]));
  const bind = file.tasks?.[task]?.bind;
  if (bind === undefined) return { fields, expressions: [] };
  const gone =
    Object.keys(bind).length === 1
      ? formatKeyPath(['tasks', task, 'bind'])
      : formatKeyPath(['tasks', task, 'bind', name]);
  const result = doc.applyBatch(clearOps(doc, gone));
  if ('refused' in result) return { fields, expressions: [] };
  const before = new Set(doc.problems().map(problemKey));
  const expressions = result.problems
    .filter((p) => !before.has(problemKey(p)))
    .filter((p) => p.path === scope || p.path.startsWith(`${scope}.`) || p.path.startsWith(`${scope}[`))
    .filter((p) => !formEntries.some((e) => p.path === e || p.path.startsWith(`${e}.`)))
    .map((p) => `${labelOf(p.message, locale, p.code)} (${p.path})`);
  return { fields, expressions: [...new Set(expressions)] };
}
