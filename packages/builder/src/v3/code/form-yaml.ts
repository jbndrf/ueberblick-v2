/**
 * v3's "Formular kopieren" (`EntityYamlView.svelte:86`): the form part of one task as YAML, the `form` map
 * and, for a multi-step task, its `steps` order. Read from the effective file; the text has the same shape
 * as the task's YAML tab.
 */
import { stringify } from 'yaml';
import type { Doc } from '../../doc';

/** `''` when the task is unknown or has no form. */
export function formYaml(doc: Doc, task: string): string {
  const def = doc.effective().tasks?.[task];
  if (def === undefined || def.form === undefined) return '';
  return stringify(def.steps === undefined ? { form: def.form } : { form: def.form, steps: def.steps }, {
    lineWidth: 0,
  });
}
