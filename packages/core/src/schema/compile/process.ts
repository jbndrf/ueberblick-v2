/**
 * The `process` of a feature type (A-028 item 1): it must name a `select` property, `start` and `end`
 * must be its options, `end` is non-empty and never holds `start`, the property has no `default`
 * (`start` replaces it), and no form field writes it (only `then.set` steps do, as in v3).
 */
import type { TemplateFile } from '../file';
import { stepProperties } from '../steps-of';
import { taskTypes } from './indexes';
import { kp } from './kp';
import type { Sink } from './problems';

export function checkProcesses(file: TemplateFile, sink: Sink): void {
  for (const [tk, type] of Object.entries(file.types ?? {})) {
    const decl = type.process;
    if (decl === undefined) continue;
    const at = (...rest: (string | number)[]): string => kp('types', tk, 'process', ...rest.map(String));
    const prop = type.properties[decl.property];
    if (prop === undefined || prop.type !== 'select') {
      sink.error(
        at('property'),
        'process_property_invalid',
        {
          en: `process property '${decl.property}' of ${tk} is not a select property`,
          de: `Die Prozess-Eigenschaft '${decl.property}' von ${tk} ist keine Auswahl-Eigenschaft`,
        },
        `name a property of type select of ${tk}`,
        { type: tk, property: decl.property },
      );
      continue;
    }
    const options = Object.keys(prop.options ?? {});
    const unknown = (path: string, value: string): void =>
      sink.error(
        path,
        'process_stage_unknown',
        {
          en: `'${value}' is not an option of ${tk}.${decl.property}`,
          de: `'${value}' ist keine Option von ${tk}.${decl.property}`,
        },
        `use one of: ${options.join(', ')}`,
        { value, type: tk, property: decl.property, existing: options.join(', ') },
      );
    if (!options.includes(decl.start)) unknown(at('start'), decl.start);
    decl.end.forEach((e, i) => {
      if (!options.includes(e)) unknown(at('end', i), e);
    });
    if (decl.end.length === 0 || decl.end.includes(decl.start)) {
      sink.error(
        at('end'),
        'process_end_invalid',
        {
          en: `the end stages of ${tk} must name at least one stage and must not contain the start`,
          de: `Die Endstufen von ${tk} müssen mindestens eine Stufe nennen und dürfen den Start nicht enthalten`,
        },
        'list the stages that finish the process, e.g. `end: [erledigt]`',
        { type: tk },
      );
    }
    if (prop.default !== undefined) {
      sink.error(
        kp('types', tk, 'properties', decl.property, 'default'),
        'process_property_default',
        {
          en: `${tk}.${decl.property} is the process property, so 'start' replaces its default`,
          de: `${tk}.${decl.property} ist die Prozess-Eigenschaft, 'start' ersetzt ihren Standardwert`,
        },
        `remove the default and set \`process.start\` to '${prop.default}'`,
        { type: tk, property: decl.property, default: String(prop.default) },
      );
    }
  }
  for (const [key, task] of Object.entries(file.tasks ?? {})) {
    const typeKeys = task.creates !== undefined ? [task.creates] : taskTypes(task);
    for (const tk of typeKeys) {
      const decl = file.types?.[tk]?.process;
      if (decl === undefined) continue;
      const inForm = task.form?.[decl.property] !== undefined;
      if (!inForm && !stepProperties(task).includes(decl.property)) continue;
      sink.error(
        inForm ? kp('tasks', key, 'form', decl.property) : kp('tasks', key, 'steps'),
        'process_property_written',
        {
          en: `task '${key}' has a form field for the process property ${tk}.${decl.property}`,
          de: `Die Aufgabe '${key}' hat ein Formularfeld für die Prozess-Eigenschaft ${tk}.${decl.property}`,
        },
        `remove the field; move the stage with a \`then\` step \`set: { ${decl.property}: "'<stage>'" }\``,
        { task: key, type: tk, property: decl.property },
      );
    }
  }
}
