import { SubmitRefusedError, type RunDraft, type RunProgress, type RunSubmitter } from '@ueberblick/ui';

/** The device refused the run before anything was sent; the reason is already the plain sentence. */
export class LocalRefusalError extends SubmitRefusedError {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'LocalRefusalError';
  }
}

export interface LocalRefusalOptions {
  /** Drops the refused draft the device stored: v3 queued nothing for a local refusal. */
  readonly discard: (runId: string) => Promise<unknown>;
  /** The reason of a run the device refused, for v3's red "Nicht möglich" box. */
  readonly onrefused: (reason: string) => void;
  /** A run was stored: an earlier notice is over. */
  readonly onstored?: () => void;
}

/**
 * v3's `TaskRunRejectedError` (detail module :205-211): a refusal the device makes at once is the first progress of the
 * stored run (the same signal `closeOnResult` relies on). The refused draft is dropped, the reason goes to the box, and
 * the submit fails so the form stays open as in v3. A refusal by the server comes later and is not seen here.
 */
export function localRefusal(inner: RunSubmitter, o: LocalRefusalOptions): RunSubmitter {
  // The device reads the stored row (asynchronously) and always reports it: a stored run has a first progress.
  const firstProgress = (id: RunDraft['id']): Promise<RunProgress> =>
    new Promise((resolve) => {
      let settled = false;
      const off = inner.outcome(id, (p) => {
        if (settled) return;
        settled = true;
        resolve(p);
        queueMicrotask(() => off());
      });
    });
  return {
    async submit(run) {
      const queued = await inner.submit(run);
      const first = await firstProgress(run.id);
      if (first.state === 'refused') {
        // a draft that cannot be dropped stays in the queue list; the reason is shown either way
        await Promise.resolve()
          .then(() => o.discard(run.id))
          .catch(() => undefined);
        o.onrefused(first.reason);
        throw new LocalRefusalError(first.reason);
      }
      o.onstored?.();
      return queued;
    },
    outcome: (id, listener) => inner.outcome(id, listener),
  };
}
