/**
 * `task_field_not_writable`: a task's form sets a property that no role in the task's audience may
 * write. Readonly fields are writes too (no exemption), so the run would be refused. A `computed`
 * property is display-only in a form (B-027): the run never carries it, so it is skipped.
 * The audience is the roles named by the task's `who` (the reserved `admin` is no role); a task without `who` has none.
 */
import type { TemplateFile } from '../file';
import { stepProperties } from '../steps-of';
import { taskTypes } from './indexes';
import { kp } from './kp';
import type { Sink } from './problems';
import { roleSubject } from '../../perms/actor';
import { scoped, writableProperties } from '../../perms/write';

export function checkTaskFieldsWritable(file: TemplateFile, sink: Sink): void {
  const declared = Object.keys(file.roles ?? {});
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const typeKeys = task.creates !== undefined ? [task.creates] : taskTypes(task);
    // The audience is the task's `who` (C-004 step 3); a task without it is run by the system only.
    const audience = (task.who ?? []).filter((r) => declared.includes(r));
    if (typeKeys.length === 0 || audience.length === 0) continue;
    for (const field of [...Object.keys(task.form ?? {}), ...stepProperties(task)]) {
      const at =
        task.form?.[field] === undefined ? kp('tasks', key, 'steps') : kp('tasks', key, 'form', field);
      const blocked = new Set<string>(); // types where no audience role may write the field
      const partly = new Map<string, Set<string>>(); // role -> types where only other roles may
      for (const tk of typeKeys) {
        const type = file.types?.[tk];
        const prop = type?.properties[field];
        if (type === undefined || prop === undefined) continue;
        if ('computed' in prop && prop.computed !== undefined) continue; // display-only (B-027)
        const write = scoped(type.permissions?.write);
        const props = Object.keys(type.properties);
        const refused = audience.filter(
          (role) => !writableProperties(write, props, [roleSubject(role)]).has(field),
        );
        if (refused.length === audience.length) blocked.add(tk);
        else if (task.creates === undefined && task.form?.[field]?.relevant === undefined)
          for (const r of refused) partly.set(r, (partly.get(r) ?? new Set()).add(tk));
      }
      if (blocked.size > 0)
        sink.warn(
          at,
          'task_field_not_writable',
          `no role that may run task '${key}' (${audience.join(', ')}) may write '${field}' of ${[...blocked].join(', ')}, so the run is refused`,
          `add one of these roles to \`permissions.write\` for '${field}' (a readonly or calculated field is a write too), or remove the field from the form`,
          { task: key, roles: audience.join(', '), field, types: [...blocked].join(', ') },
        );
      if (partly.size > 0)
        sink.warn(
          at,
          'task_role_cannot_write',
          `role ${[...partly.keys()].map((r) => `'${r}'`).join(', ')} sees task '${key}' but may not write '${field}', so its run is always refused`,
          `remove the role from the \`when\` of task '${key}', or add it to \`permissions.write\` for '${field}'`,
          { task: key, roles: [...partly.keys()].join(', '), field },
        );
    }
  }
}
