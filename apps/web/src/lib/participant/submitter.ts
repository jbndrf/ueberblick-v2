/**
 * `RunSubmitter` of the task sheet over the run queue (WP-511). `submit` resolves once the run is durably stored on
 * the device (`enqueue` stores, predicts, then returns); sending starts at once but is never awaited (offline first).
 * `outcome` follows one run through the queue's stored rows, so "queued", "accepted" and a typed refusal are what the
 * device knows, not a guess from an HTTP status.
 */
import type { DrainResult, EnqueueResult, QueueStatus, RunQueue, StoredRun } from '@ueberblick/client';
import type { Actor, Json, RunId } from '@ueberblick/core/model';
import { isRefusedRunState } from '@ueberblick/core/registry';
import type { RunDraft, RunProgress, RunSubmitter } from '@ueberblick/ui';
import type { PendingBlobs } from './blobs';
import { message, type Locale } from './messages';
import { runRefusalText } from './refusals';

export type SubmitterQueue = Pick<RunQueue, 'enqueue' | 'subscribe'> & {
  drain(): Promise<DrainResult>;
  status(): QueueStatus;
};
export interface SubmitterStore {
  readRuns(): Promise<readonly StoredRun[]>;
}

export interface SubmitterDeps {
  readonly queue: SubmitterQueue;
  readonly store: SubmitterStore;
  readonly actor: Actor;
  /** The config version this device plans against; every run records it. */
  readonly configVersion: number;
  readonly blobs: PendingBlobs;
  readonly locale: Locale;
  /** The label of a task's field, for the "Feld: …" line of a refusal. */
  readonly fieldLabel?: (taskKey: string, fieldKey: string) => string | undefined;
  readonly onError?: (error: unknown) => void;
}

/**
 * A run input is JSON by contract. A form value can still be a reactive proxy (a `$state` object handed on as the
 * initial value), and IndexedDB's structured clone throws on a Proxy (WP-696), so the device gets a plain copy.
 */
const plain = <T extends Readonly<Record<string, Json>>>(input: T): T =>
  JSON.parse(JSON.stringify(input)) as T;

export function createSubmitter(deps: SubmitterDeps): RunSubmitter {
  const { queue, store, actor, configVersion, blobs, locale } = deps;
  /** Runs stored by this submitter: a stored run that is gone from the queue was accepted and pulled. */
  const stored = new Set<RunId>();
  const fail = (e: unknown): void => deps.onError?.(e);

  async function progressOf(runId: RunId): Promise<RunProgress | undefined> {
    const row = (await store.readRuns()).find((r) => r.run.id === runId);
    if (row === undefined) return stored.has(runId) ? { state: 'accepted' } : undefined;
    if (isRefusedRunState(row.state))
      return {
        state: 'refused',
        reason: runRefusalText(locale, row, (f) => deps.fieldLabel?.(row.run.task, f)),
      };
    if (row.state === 'review')
      return { state: 'refused', reason: message(locale, 'review_gone', { version: row.run.configVersion }) };
    return row.state === 'accepted' ? { state: 'accepted' } : { state: 'queued' };
  }

  return {
    async submit(draft: RunDraft): Promise<'queued'> {
      const run = {
        id: draft.id,
        task: draft.task,
        ...(draft.featureId === undefined ? {} : { featureId: draft.featureId }),
        actor: { ...actor }, // the roles of this moment: the device's actor follows later changes
        configVersion,
        input: plain(draft.input),
      };
      let result: EnqueueResult;
      try {
        result = await queue.enqueue(run, await blobs.take(run.input));
      } catch (e) {
        // The caller shows one localized sentence; the cause stays findable (WP-696).
        console.error('The run could not be stored on the device', e);
        throw e;
      }
      stored.add(draft.id);
      // A device refusal is stored as a refused draft and shows through `outcome`; nothing to send then.
      if (result.ok) queue.drain().catch(fail);
      return 'queued';
    },

    outcome(runId, listener) {
      let last: string | undefined;
      let live = true;
      const push = (): void => {
        progressOf(runId)
          .then((p) => {
            if (!live || p === undefined) return;
            const key = JSON.stringify(p);
            if (key === last) return;
            last = key;
            listener(p);
          })
          .catch(fail);
      };
      const off = queue.subscribe(push);
      push();
      return () => {
        live = false;
        off();
      };
    },
  };
}
