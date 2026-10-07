/**
 * Which tasks edit the location, so they go straight onto the map instead of showing a form (v3 `handleTaskInvoke`,
 * v3 detail module :583-606: a location step, or a step that places the geometry field, closes the
 * sheet and starts the pin or the draw tool). v4's task schema tells it without a core change: a `location` step, or a
 * form field whose property is a geometry. A location step among several steps stays a step of the flow (WP-636).
 */
import { stepsOf } from '@ueberblick/core/form';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { FeatureId, Key, RunId } from '@ueberblick/core/model';
import type { Json } from '@ueberblick/ui';
import { taskTypeOf } from '../tools';

export interface Placing {
  /** The geometry property the person moves or redraws. */
  readonly property: string;
  /** Nothing else to ask: the confirm submits the run. Otherwise the form opens with the new geometry (v3 :1041-1053 submits at once). */
  readonly alone: boolean;
}

export function placingOf(file: CompiledConfig['file'], taskKey: string): Placing | undefined {
  const task = file.tasks?.[taskKey];
  if (task === undefined) return undefined;
  const formKeys = Object.keys(task.form ?? {});
  const steps = stepsOf(task).filter((s) => s.kind !== 'form' || formKeys.length > 0);
  const only = steps.length === 1 ? steps[0] : undefined;
  if (only?.kind === 'location') return { property: only.property, alone: true };
  if (only?.kind !== 'form') return undefined;
  const type = taskTypeOf(file, taskKey);
  const properties = type === undefined ? {} : (file.types?.[type]?.properties ?? {});
  const property = formKeys.find((k) => properties[k]?.type === 'geometry');
  return property === undefined ? undefined : { property, alone: formKeys.length === 1 };
}

/** What the run of a placed geometry is: one run on the feature with the new geometry as the property's value (v3 `submitGeometry`, :1041-1053). */
export interface PlacedRun {
  readonly id: RunId;
  readonly task: Key;
  readonly featureId: FeatureId;
  readonly input: Readonly<Record<string, Json>>;
}

export const placedRun = (
  runId: RunId,
  task: string,
  featureId: FeatureId,
  property: string,
  geometry: Json,
): PlacedRun => ({ id: runId, task: task as Key, featureId, input: { [property]: geometry } });
