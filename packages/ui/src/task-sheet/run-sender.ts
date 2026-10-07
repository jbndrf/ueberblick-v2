// The one place a sheet turns its values into run drafts and follows them (R1): the task sheet and the multi-step flow
// both use it. No Svelte, no storage: the run queue is the `RunSubmitter` port.
import type { FeatureId, Key, RunId } from '@ueberblick/core/model';
import type { Ids } from '@ueberblick/core/ports';
import type { Json } from '../form/contract';
import { SubmitRefusedError, type RunDraft, type RunProgress, type RunSubmitter } from './contract';

export interface RunSenderOptions {
  readonly taskKey: Key;
  readonly ids: Pick<Ids, 'runId'>;
  readonly submitter: RunSubmitter;
  /** Read at each submit. None: a task that creates a feature. Several (H2): one run per feature. */
  readonly featureIds: () => readonly FeatureId[] | undefined;
}

/**
 * Stored; or not stored, because a submit is already running (`busy`), the device could not save it, or the submitter
 * refused it and explained that itself (`explained`, see `SubmitRefusedError`).
 */
export type SubmitResult =
  { readonly stored: true } | { readonly stored: false; readonly busy: boolean; readonly explained?: true };

export interface RunSender {
  /** Stores one run per target. Ids are minted once per attempt, so a retry after a failed save is the same run (idempotent). */
  submit(input: Readonly<Record<string, Json>>): Promise<SubmitResult>;
  /** Follows the stored runs; `onchange` gets the progress of every run so far. */
  watch(onchange: (progress: Readonly<Record<string, RunProgress>>) => void): void;
  /** Forgets the runs, so the next submit makes new ones (after a refusal). */
  reset(): void;
  dispose(): void;
}

/** The refusal of a set of runs (refused wins) and whether every run is accepted. */
export function summarize(
  progress: Readonly<Record<string, RunProgress>>,
  runIds: readonly RunId[] | undefined,
): { readonly refusal: string | undefined; readonly accepted: boolean } {
  const refused = Object.values(progress).find(
    (x): x is Extract<RunProgress, { state: 'refused' }> => x.state === 'refused',
  );
  return {
    refusal: refused?.reason,
    accepted: runIds !== undefined && runIds.every((id) => progress[id]?.state === 'accepted'),
  };
}

export function createRunSender(
  o: RunSenderOptions,
): RunSender & { readonly runIds: () => RunId[] | undefined } {
  let runIds: RunId[] | undefined;
  let busy = false;
  let unsubscribe: (() => void)[] = [];
  let progress: Record<string, RunProgress> = {};
  const targets = (): (FeatureId | undefined)[] => {
    const ids = o.featureIds();
    return ids?.length ? [...ids] : [undefined];
  };
  const stop = (): void => {
    unsubscribe.forEach((u) => u());
    unsubscribe = [];
  };
  return {
    runIds: () => runIds,
    async submit(input) {
      // Set synchronously on the first tap: a second tap finds it and returns.
      if (busy) return { stored: false, busy: true };
      busy = true;
      runIds ??= targets().map(() => o.ids.runId());
      const ids = runIds;
      const runs: RunDraft[] = targets().map((featureId, i) => ({
        id: ids[i] as RunId,
        task: o.taskKey,
        ...(featureId ? { featureId } : {}),
        input,
      }));
      try {
        await Promise.all(runs.map((r) => o.submitter.submit(r)));
      } catch (error) {
        busy = false;
        return error instanceof SubmitRefusedError
          ? { stored: false, busy: false, explained: true }
          : { stored: false, busy: false };
      }
      return { stored: true };
    },
    watch(onchange) {
      for (const id of runIds ?? [])
        unsubscribe.push(
          o.submitter.outcome(id, (next) => {
            progress = { ...progress, [id]: next };
            onchange(progress);
          }),
        );
    },
    reset() {
      stop();
      progress = {};
      runIds = undefined;
      busy = false;
    },
    dispose: stop,
  };
}
