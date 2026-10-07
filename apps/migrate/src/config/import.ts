/**
 * The import tasks (WP-301, WP-149): every feature type gets a task that creates it and a task that updates it, so the
 * data conversion can write import runs (R3). Both are for the actor kind `import` only (`who: [import]`), so no participant gains a permission. Their forms carry every property of the type: `planRows` maps import columns onto form fields.
 */
import type { CompiledConfig, FeatureType, Task, TemplateFile } from '@ueberblick/core';
import type { KeySpace } from './keys';

export interface ImportTasks {
  readonly create: string;
  readonly update: string;
}

/** The project to import into: the converted project without rules, compiled. */
export interface ImportTarget {
  readonly file: TemplateFile;
  readonly config: CompiledConfig;
  /** By v4 feature type key. */
  readonly tasks: Readonly<Record<string, ImportTasks>>;
}

const formOf = (type: FeatureType): NonNullable<Task['form']> =>
  Object.fromEntries(Object.keys(type.properties).map((k) => [k, {}]));

/** Adds `<type>_import` and `<type>_import_update` for every type to `tasks`; returns their keys by type. */
export function addImportTasks(
  tasks: Record<string, Task>,
  types: Readonly<Record<string, FeatureType>>,
  keys: KeySpace,
): Record<string, ImportTasks> {
  const out: Record<string, ImportTasks> = {};
  for (const [type, def] of Object.entries(types)) {
    const create = keys.take(`${type}_import`);
    const update = keys.take(`${create}_update`);
    tasks[create] = {
      label: `Import: ${type}`,
      on: '$none',
      who: ['import'],
      creates: type,
      form: formOf(def),
    };
    tasks[update] = { label: `Import history: ${type}`, on: type, who: ['import'], form: formOf(def) };
    out[type] = { create, update };
  }
  return out;
}
