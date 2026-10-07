/**
 * What the feature sheet reads from the device and what a tap on an action does. Both stay thin: which tasks are
 * offered is `core.plan` (through the reader), which properties may be read is `core.perms`, the rows are the UI
 * package's model builder. Nothing here scans features: one feature, its properties, its edges (R14).
 */
import type { Actor, FeatureId, FeatureType, Key } from '@ueberblick/core/model';
import { processesOf } from '@ueberblick/core';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { compilePerms } from '@ueberblick/core/perms';
import type { Perms } from '@ueberblick/core/perms';
import type { Ids } from '@ueberblick/core/ports';
import { stepsOf } from '@ueberblick/core/form';
import {
  buildActivity,
  buildFeatureSheetModel,
  type ActivityView,
  type FeatureSheetInput,
  type RunSubmitter,
} from '@ueberblick/ui';
import type { Reader } from '../reader';
import { conditionFalse } from './data/conditions';
import { buildDataLayout, type DataSheetModel } from './data/layout';

export interface SheetDeps {
  readonly reader: Reader;
  readonly config: CompiledConfig;
  readonly actor: Actor;
}

const compiled = new WeakMap<CompiledConfig, Perms>();
const permsOf = (config: CompiledConfig): Perms => {
  let perms = compiled.get(config);
  if (perms === undefined) {
    perms = compilePerms(config);
    compiled.set(config, perms);
  }
  return perms;
};

/** The reader's input with `properties` cut to what the role may read (config order), or undefined when not here. */
function readableInput(deps: SheetDeps, id: FeatureId, locale?: string): FeatureSheetInput | undefined {
  const input = deps.reader.sheetInput(id, locale);
  if (input === undefined) return undefined;
  const perms = permsOf(deps.config);
  const readable = perms.forType(input.feature.type)?.readable(perms.subjects(deps.actor));
  // Config order, and only what the role may read (the rest is stripped before sync; a stripped one is not "no value").
  const properties = (Object.keys(input.type.properties) as Key[]).filter(
    (key) => readable === undefined || readable.has(key),
  );
  // "main value - 2 h ago": the feature's last change from the sync row (audit metadata), when the device has it.
  const updatedAt = input.updatedAt ?? input.feature.changedAt;
  // The device is opened once, but the person may switch the language: the live one wins for labels and formats.
  return {
    ...input,
    properties,
    ...(locale === undefined ? {} : { locale }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

/**
 * The properties that are machinery, not data: the type's primary geometry and its process's stage property. v3 never
 * rendered its system `stage` and `geometry` defs as rows in Daten (`isReadableDataField`, state.svelte.ts:463-471);
 * the stage is the header's and Aktivität's, the position is the map's. They stay in the input (Aktivität needs the
 * stage), they only leave the Daten rows. The lifecycle and audit metadata are not properties, so no row ever (R4).
 */
function machineryKeys(type: FeatureType): ReadonlySet<Key> {
  const keys = new Set<Key>();
  if (type.geometry !== undefined) keys.add(type.geometry as Key);
  for (const process of processesOf(type)) keys.add(process.property);
  return keys;
}

/** The sheet's model for a feature on this device (with the Daten layout, WP-659), or undefined when it is not here. */
export function sheetModelFor(deps: SheetDeps, id: FeatureId, locale?: string): DataSheetModel | undefined {
  const input = readableInput(deps, id, locale);
  if (input === undefined) return undefined;
  const built = buildFeatureSheetModel(input);
  const machinery = machineryKeys(input.type);
  const model = {
    ...built,
    rows: built.rows.filter((r) => !machinery.has(r.key)),
    history: built.history.filter((h) => !machinery.has(h.property)),
  };
  const keys = model.rows.map((r) => r.key);
  const ctx = deps.reader.taskContext(id);
  const hidden = conditionFalse(deps.config, input.feature.type, keys, ctx);
  const layout = buildDataLayout({
    type: input.type,
    rows: model.rows,
    conditionFalse: hidden,
    locale: input.locale,
  });
  return { ...model, layout };
}

/**
 * The Aktivität timeline of a feature (v3: stage visits, "Erstellt", one line per run), built from the runs on the
 * device. The reader needs `warmActivity(id)` first, or the timeline is empty.
 */
export function activityFor(deps: SheetDeps, id: FeatureId, locale?: string): ActivityView | undefined {
  const input = readableInput(deps, id, locale);
  return input === undefined ? undefined : buildActivity(input);
}

export interface StartDeps {
  readonly config: CompiledConfig;
  readonly submitter: RunSubmitter;
  readonly ids: Pick<Ids, 'runId'>;
}

/**
 * A tap on an action. A task without a form or steps has nothing to ask, so it submits at once (v3: `fieldPlacements(task)
 * .length === 0` submits, v3 detail module, line 620); a task whose only step is a quick edit edits in place in Daten
 * (v3 :608-617); every other task (a form, several steps, a location) is left to the task sheet.
 */
export async function startTask(
  deps: StartDeps,
  task: Key,
  feature: FeatureId,
): Promise<'submitted' | 'form' | 'quick_edit'> {
  const def = deps.config.file.tasks?.[task];
  const steps = def === undefined ? [] : stepsOf(def).filter((s) => s.kind !== 'form' || hasFields(def.form));
  if (steps.length === 1 && steps[0]?.kind === 'quick_edit') return 'quick_edit';
  if (steps.length > 0) return 'form';
  await deps.submitter.submit({ id: deps.ids.runId(), task, featureId: feature, input: {} });
  return 'submitted';
}

const hasFields = (form: object | undefined): boolean => form !== undefined && Object.keys(form).length > 0;
