/**
 * What the view builder offers one person (WP-665, v3 `+page.svelte:1405-1461`): the Objektarten that have a place on
 * the map, their readable properties that have an editor (v3: every non-file field; v3's field types were text,
 * number, date, dropdown and multiple choice, which are the registry's `FILTER_EDITOR_BY_TYPE`), and the stages of
 * each process. Computed from the compiled config and the actor's permissions (`filterFields`), never from data.
 */
import { localize } from '../locale';
import type { Actor } from '../model';
import { processesOf } from '../process';
import { type PropertyTypeKey } from '../registry';
import { type FilterEditor, FILTER_EDITOR_BY_TYPE } from '../registry/filter';
import type { CompiledConfig } from '../schema/compile/contract';
import { filterFields } from './fields';

export interface BuilderOption {
  readonly value: string;
  readonly label: string;
}

export interface BuilderField {
  readonly type: string;
  readonly typeLabel: string;
  readonly key: string;
  readonly label: string;
  readonly propType: PropertyTypeKey;
  readonly editor: FilterEditor;
  readonly options: readonly BuilderOption[];
}

export interface BuilderStages {
  readonly type: string;
  readonly typeLabel: string;
  /** The `select` property that holds the stage. */
  readonly property: string;
  readonly stages: readonly BuilderOption[];
}

export interface BuilderContext {
  /** The Objektarten the "when" and "created by" rows apply to. */
  readonly types: readonly string[];
  readonly fields: readonly BuilderField[];
  readonly stages: readonly BuilderStages[];
}

export function builderContext(config: CompiledConfig, actor: Actor, locale: string): BuilderContext {
  const locales = [locale];
  const types: string[] = [];
  const fields: BuilderField[] = [];
  const stages: BuilderStages[] = [];
  for (const [type, def] of Object.entries(config.file.types ?? {})) {
    if (def.geometry === undefined) continue;
    types.push(type);
    const typeLabel = localize(def.label, locales);
    const process = processesOf(def)[0];
    const offered = filterFields(config, type, actor);
    for (const f of offered) {
      const editor = FILTER_EDITOR_BY_TYPE[f.type];
      if (editor === undefined || f.key === process?.property) continue;
      const options =
        f.options === undefined
          ? []
          : Object.entries(f.options).map(([value, label]) => ({ value, label: localize(label, locales) }));
      // A select always declares its options in v4; one without has nothing to pick from, so it is not offered.
      if (editor === 'choice' && options.length === 0) continue;
      fields.push({
        type,
        typeLabel,
        key: f.key,
        label: f.label === undefined ? f.key : localize(f.label, locales),
        propType: f.type,
        editor,
        options,
      });
    }
    const stageField = process === undefined ? undefined : offered.find((f) => f.key === process.property);
    if (process !== undefined && stageField !== undefined)
      stages.push({
        type,
        typeLabel,
        property: process.property,
        stages: process.options.map((value) => ({
          value,
          label: localize(stageField.options?.[value] ?? value, locales),
        })),
      });
  }
  const label = (a: BuilderField, b: BuilderField): number =>
    a.typeLabel.localeCompare(b.typeLabel, locale) || a.label.localeCompare(b.label, locale);
  return { types, fields: fields.sort(label), stages };
}

/** The distinct creators of the features given (WP-306 `createdBy`), in first-seen order. One pass, no sorting by name here. */
export function creatorIds(features: Iterable<{ readonly createdBy?: string }>): readonly string[] {
  const seen = new Set<string>();
  for (const f of features) if (f.createdBy !== undefined) seen.add(f.createdBy);
  return [...seen];
}
