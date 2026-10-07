/** Checks of `tasks.<t>.who` and of what an automatic run needs (C-004 step 3). */
import { TASK_WHO_RESERVED } from '../../registry';
import type { TemplateFile } from '../file';
import { listAutos } from './autos';
import { kp } from './kp';
import type { Sink } from './problems';

/** Every `who` entry is a role of the file or a reserved entry (`admin`; a role of that name is admitted too). */
export function checkWho(file: TemplateFile, sink: Sink): void {
  const known = [...new Set([...Object.keys(file.roles ?? {}), ...TASK_WHO_RESERVED.keys])];
  for (const [key, task] of Object.entries(file.tasks ?? {}))
    (task.who ?? []).forEach((r, i) => {
      if (!known.includes(r)) sink.dangling(kp('tasks', key, 'who', i), 'role', r, known);
    });
}

/**
 * An automatic run has no form, so a required form field must be given a value by `then.set` (for example
 * `form.x != null ? form.x : self.y`): otherwise the run would have nothing to write. One problem per task and field.
 */
export function checkAutoValues(file: TemplateFile, sink: Sink): void {
  const withAuto = new Map<string, string[]>();
  for (const a of listAutos(file)) withAuto.set(a.task, [...(withAuto.get(a.task) ?? []), a.name]);
  for (const [task, names] of withAuto) {
    const def = file.tasks?.[task];
    if (def === undefined) continue;
    const set = new Set<string>();
    for (const step of def.then ?? [])
      if (step.set !== undefined && step.of === undefined) for (const k of Object.keys(step.set)) set.add(k);
    for (const [field, f] of Object.entries(def.form ?? {})) {
      if (f.required === undefined || f.required === false || set.has(field)) continue;
      sink.error(
        kp('tasks', task, 'form', field),
        'auto_value_missing',
        `task '${task}' runs automatically (${names.join(', ')}) but its required field '${field}' has no value then: an automatic run has no form`,
        `add \`then: [{ set: { ${field}: "form.${field} != null ? form.${field} : <value>" } }]\` to the task`,
        { task, field, autos: names.join(', ') },
      );
    }
  }
}
