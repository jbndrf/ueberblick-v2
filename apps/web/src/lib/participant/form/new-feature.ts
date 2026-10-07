import type { FeatureId, RunId } from '@ueberblick/core/model';
import type { Ids } from '@ueberblick/core/ports';
import type { TemplateFile } from '@ueberblick/core/schema';
import type { RunDraft, RunSubmitter } from '@ueberblick/ui';

/**
 * The plan takes the id of the feature a task creates on the map from the run (`on: $map`, `core/plan/run.ts`), so the
 * form can mint it before submitting and knows what to open once the run is accepted (v3 opened the new case from the
 * submit's answer, `+page.svelte:2323`). A task that creates with `on: $none` has no such id on the device.
 */
export function createsOnMap(file: TemplateFile, taskKey: string): boolean {
  const task = file.tasks?.[taskKey];
  return task?.creates !== undefined && task.on === '$map';
}

/** A task that creates, but not on the map (`on: $none`): its id comes from the queue's plan of the run (WP-681). */
export function createsOffMap(file: TemplateFile, taskKey: string): boolean {
  const task = file.tasks?.[taskKey];
  return task?.creates !== undefined && task.on !== '$map';
}

export type MintingSubmitter = RunSubmitter & {
  /** The feature id of the run last submitted, or undefined when nothing was minted. */
  readonly created: () => FeatureId | undefined;
};

/** Puts a new feature id on every run submitted through it (when `enabled`) and remembers the last. */
export function mintNewFeatureId(
  inner: RunSubmitter,
  ids: Pick<Ids, 'featureId'>,
  enabled: boolean,
): MintingSubmitter {
  let last: FeatureId | undefined;
  return {
    async submit(run: RunDraft) {
      if (!enabled) return inner.submit(run);
      const featureId = run.featureId ?? ids.featureId();
      last = featureId;
      try {
        return await inner.submit({ ...run, featureId });
      } catch (e) {
        last = undefined;
        throw e;
      }
    },
    outcome: (id, listener) => inner.outcome(id, listener),
    created: () => last,
  };
}

/**
 * For a create the device cannot name before planning (`on: $none`): after the run is stored, the id of the feature its
 * plan created comes from the run queue (`RunQueue.createdBy`, seeded from the run id, WP-681). A refused run, or one
 * that creates nothing, gives undefined. Wraps a `mintNewFeatureId` so `created()` answers for both kinds of create.
 */
export function reportCreated(
  inner: MintingSubmitter,
  createdBy: (runId: RunId) => readonly FeatureId[],
  enabled: boolean,
): MintingSubmitter {
  let lastRun: RunId | undefined;
  return {
    async submit(run: RunDraft) {
      if (enabled) lastRun = run.id;
      try {
        return await inner.submit(run);
      } catch (e) {
        lastRun = undefined;
        throw e;
      }
    },
    outcome: (id, listener) => inner.outcome(id, listener),
    created: () => inner.created() ?? (lastRun === undefined ? undefined : createdBy(lastRun)[0]),
  };
}
