/** A form key `<bind>.<property>` (A-047): the bound property must not be the process stage (only `then.set` moves it). */
import type { Ty } from '../../expr/check';
import type { TemplateFile } from '../file';
import type { Sink } from './problems';

export function checkBindField(
  sink: Sink,
  file: TemplateFile,
  task: string,
  path: string,
  owner: Ty | undefined,
  key: string,
): void {
  const prop = key.slice(key.indexOf('.') + 1);
  if (owner?.kind !== 'feature' || file.types?.[owner.type]?.process?.property !== prop) return;
  sink.error(
    path,
    'process_property_written',
    {
      en: `task '${task}' has a form field for the process property ${owner.type}.${prop}`,
      de: `Die Aufgabe '${task}' hat ein Formularfeld für die Prozess-Eigenschaft ${owner.type}.${prop}`,
    },
    `remove the field; move the stage with a \`then\` step \`set: { ${key}: "'<stage>'" }\``,
    { task, type: owner.type, property: prop },
  );
}
