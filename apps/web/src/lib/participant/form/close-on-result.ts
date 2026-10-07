import type { RunDraft, RunProgress, RunSubmitter } from '@ueberblick/ui';

export interface CloseOnResultOptions {
  readonly onclose: () => void;
}

export type ResultSubmitter = RunSubmitter & { readonly dispose: () => void };

/**
 * The form closes once its runs are safely stored on the device, as in v3 (the v3 detail module (`map/modules/…-detail/…Module.svelte:754-756`):
 * `await submitTask(...)`, then the form is dropped). It never waits for the server: a run that is not sent yet shows
 * "Noch nicht übertragen" and a refusal by the server shows "Abgelehnt" in the feature sheet's run notices (WP-647).
 * The one exception is v3's `TaskRunRejectedError` (`:205-210`): a refusal the device makes at once, which comes back
 * as the first progress of the stored run. That keeps the form open with the refusal and "Entwurf wieder öffnen". A
 * refused run drops out, so the retry (new run ids) can close it. Offline and online are the same: the first progress
 * is read from the device queue, no connection needed.
 */
export function closeOnResult(inner: RunSubmitter, o: CloseOnResultOptions): ResultSubmitter {
  const pending = new Set<string>();
  const unsubscribe: (() => void)[] = [];
  let disposed = false;

  function first(id: string, next: RunProgress): void {
    if (disposed || !pending.has(id)) return;
    pending.delete(id);
    if (next.state === 'refused') return;
    if (pending.size === 0) {
      disposed = true;
      o.onclose();
    }
  }

  return {
    async submit(run: RunDraft) {
      // registered before the first await: the runs of one submit are all known when the first progress arrives
      pending.add(run.id);
      let queued: 'queued';
      try {
        queued = await inner.submit(run);
      } catch (e) {
        pending.delete(run.id);
        throw e;
      }
      if (disposed) return queued;
      let once = false;
      const off = inner.outcome(run.id, (p) => {
        if (once) return;
        once = true;
        first(run.id, p);
        queueMicrotask(() => off());
      });
      unsubscribe.push(() => off());
      return queued;
    },
    outcome: (id, listener) => inner.outcome(id, listener),
    dispose() {
      disposed = true;
      unsubscribe.splice(0).forEach((u) => u());
    },
  };
}
