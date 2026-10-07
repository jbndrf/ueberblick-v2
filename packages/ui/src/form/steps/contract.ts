// The multi-step task flow (WP-636): "Schritt n von m". Pure data in, run drafts out; the device, the map and the
// run queue arrive as ports, so the flow runs in a component test and in the app alike.
import type { Snippet } from 'svelte';
import type { FeatureId, Key } from '@ueberblick/core/model';
import type { Ids } from '@ueberblick/core/ports';
import type { TaskStepKind } from '@ueberblick/core/registry';
import type { RunSubmitter } from '../../task-sheet/contract';
import type { Choice, FormSession, Json, ToolSlot } from '../contract';

/** One step as the flow draws it. `form` and `quick_edit` are form sessions; `location` is the map pick. */
export type StepView =
  | { readonly kind: Exclude<TaskStepKind, 'location'>; readonly session: FormSession }
  | {
      readonly kind: Extract<TaskStepKind, 'location'>;
      readonly property: Key;
      readonly label: string;
      /** The geometry now on the feature, if any. */
      readonly current?: Json;
    };

/** What the map picker needs to open: which property, and where the shape is now. */
export interface LocationRequest {
  readonly property: Key;
  readonly label: string;
  readonly current: Json | undefined;
}

/** Port: opens the map's drawing mode (WP-635 `DrawOnMap`). Resolves with the new geometry, `undefined` when cancelled. */
export type LocationPicker = (request: LocationRequest) => Promise<Json | undefined>;

/** Every string of the flow, already in the person's language (the app's catalogue; the kit has none of its own). */
export interface StepLabels {
  readonly step: (current: number, total: number) => string;
  readonly back: string;
  readonly cancel: string;
  readonly next: string;
  readonly submit: string;
  readonly locationUnset: string;
  readonly locationSet: string;
  readonly locationPick: string;
  readonly locationUnavailable: string;
  readonly savedOnline: string;
  readonly savedOffline: string;
  readonly saveFailed: string;
  readonly accepted: string;
  readonly refused: (reason: string) => string;
  readonly reopen: string;
  readonly close: string;
}

/** The question asked before the single submit of a multi-step task (the task's `confirm`). */
export interface StepConfirm {
  readonly title: string;
  readonly text: string;
  readonly cancel: string;
  readonly go: string;
}

export interface StepFlowProps {
  readonly taskKey: Key;
  readonly steps: readonly StepView[];
  readonly labels: StepLabels;
  readonly ids: Pick<Ids, 'runId'>;
  readonly submitter: RunSubmitter;
  /** Primary features. None: a task that creates one. Several: one run per feature. */
  readonly featureIds?: readonly FeatureId[];
  readonly online: boolean;
  /** Without it the location step says so and cannot go on. */
  readonly pickLocation?: LocationPicker;
  readonly choices?: Readonly<Record<string, readonly Choice[]>>;
  readonly tool?: Snippet<[ToolSlot]>;
  /** Asked when the last step is sent (Absenden), before anything is submitted. Absent: no question. */
  readonly confirm?: StepConfirm;
  /** The first "Abbrechen" and the "Schließen" after the submit. */
  readonly onclose: () => void;
}
