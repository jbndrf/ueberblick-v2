/**
 * The inline quick edit of the Daten tab (v3 detail module :608-617, :967-1010): a task whose only step is `quick_edit`
 * does not open a form. The tab turns editable in place for the picked properties, the action row turns into
 * Abbrechen / Speichern, and Speichern submits ONE run with the changed values. State only; the sheet draws it.
 */
import type { FeatureId, Key } from '@ueberblick/core/model';
import { stepsOf } from '@ueberblick/core/form';
import { buildFormModel, resolveLabel } from '@ueberblick/ui';
import type { Choice, FormField, Json, ToolHost } from '@ueberblick/ui';
import type { Device } from '../device';
import { choicesFor } from '../form/choices';
import { fieldToolHost } from '../form/field-tools';
import { taskTypeOf } from '../tools';
import type { Locale } from '../messages';
import { quickEditForm, quickEditInput } from './quick-edit';

export type QuickEditDevice = Pick<
  Device,
  | 'config'
  | 'actor'
  | 'participant'
  | 'store'
  | 'feature'
  | 'reader'
  | 'geo'
  | 'blobs'
  | 'roleKey'
  | 'submitter'
  | 'ids'
>;

export interface QuickEdit {
  /** The header while editing: the task's button label (v3 :304). */
  readonly title: string;
  readonly fields: readonly FormField[];
  readonly choices: Readonly<Record<string, readonly Choice[]>>;
  readonly host: ToolHost;
  readonly values: Readonly<Record<string, Json>>;
  readonly saving: boolean;
  set(key: string, value: Json): void;
  cancel(): void;
  /** Submits the changes as one run; rejects when the device cannot store it. */
  save(): Promise<void>;
}

/** The picked properties of a task that is a pure quick edit; undefined for every other task. */
export function quickEditProperties(device: Pick<Device, 'config'>, task: Key): readonly Key[] | undefined {
  const def = device.config.file.tasks?.[task];
  const steps = def === undefined ? [] : stepsOf(def);
  const only = steps.length === 1 ? steps[0] : undefined;
  return only?.kind === 'quick_edit' ? (only.properties as Key[]) : undefined;
}

export function openQuickEdit(
  device: QuickEditDevice,
  task: Key,
  featureId: FeatureId,
  locale: Locale,
  onend: () => void,
): QuickEdit | undefined {
  const picked = quickEditProperties(device, task);
  const feature = device.feature(featureId);
  if (picked === undefined || feature === undefined) return undefined;
  const def = device.config.file.tasks?.[task];
  const type = taskTypeOf(device.config.file, task);
  const properties = type === undefined ? {} : (device.config.file.types?.[type]?.properties ?? {});
  const fields = buildFormModel({ form: quickEditForm(picked, properties), properties }).fields;
  const current = feature.properties as Readonly<Record<string, Json>>;
  let values = $state<Record<string, Json>>(
    Object.fromEntries(
      picked.flatMap((k): [string, Json][] => (current[k] === undefined ? [] : [[k, current[k]]])),
    ),
  );
  let saving = $state(false);
  return {
    title: resolveLabel(def?.button?.label ?? def?.label, locale, task),
    fields,
    choices: choicesFor(device, type, fields, locale),
    host: fieldToolHost(device, type, locale, () => undefined),
    get values() {
      return values;
    },
    get saving() {
      return saving;
    },
    set: (key, value) => {
      values = { ...values, [key]: value };
    },
    cancel: onend,
    async save() {
      if (saving) return;
      const input = quickEditInput(picked, current, values);
      // Nothing changed: nothing to write (v3 :987-991).
      if (Object.keys(input).length === 0) return onend();
      saving = true;
      try {
        await device.submitter.submit({ id: device.ids.runId(), task, featureId, input });
        onend();
      } finally {
        saving = false;
      }
    },
  };
}
