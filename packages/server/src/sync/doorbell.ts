/**
 * The doorbell (docs/07: "the realtime channel is only a doorbell"). It says THAT the head moved, never what
 * changed: a message is `{from, to, head}` (a seq range) and nothing else, so no telemetry and no data travel on it (H5).
 * The device answers with a pull.
 *
 * - `ring()` is called after a commit (`withDoorbell` wraps a `Store`); it looks up the head and tells every listener
 *   the range `(last, head]` once.
 * - Writers outside this process (an import CLI on the same file) do not ring. While someone listens, a cheap head
 *   check every `pollMs` (two primary-key maxima) rings for them, so the bell is never silent for long.
 */
import type { Seq } from '@ueberblick/core';
import type { Store } from '../store';

export interface DoorbellMessage {
  readonly from: Seq;
  readonly to: Seq;
  readonly head: Seq;
}

export interface Doorbell {
  /** Announces the seqs committed since the last announcement, if any. Call after a commit, never inside one. */
  ring(): void;
  /** Returns an unsubscribe function. */
  subscribe(listener: (message: DoorbellMessage) => void): () => void;
  /** The current server head (for a "hello" message on connect). */
  head(): Seq;
  readonly listeners: number;
}

export interface DoorbellOptions {
  readonly head: () => Seq;
  /** Head check while someone listens, for writers that do not ring. Default 2000 ms; 0 turns it off. */
  readonly pollMs?: number;
}

export function createDoorbell(opts: DoorbellOptions): Doorbell {
  const listeners = new Set<(m: DoorbellMessage) => void>();
  let last: Seq | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const pollMs = opts.pollMs ?? 2000;

  const ring = (): void => {
    const head = opts.head();
    const base = last ?? head;
    last = head;
    if (head <= base) return;
    const message: DoorbellMessage = { from: base + 1, to: head, head };
    // One listener's failure (a stream that closed under it) never stops the others, nor the commit that rang.
    for (const l of [...listeners])
      try {
        l(message);
      } catch {
        /* the device pulls again on its next ring or poll */
      }
  };

  return {
    ring,
    head: opts.head,
    get listeners() {
      return listeners.size;
    },
    subscribe(listener) {
      last ??= opts.head();
      listeners.add(listener);
      if (timer === undefined && pollMs > 0) {
        timer = setInterval(ring, pollMs);
        timer.unref();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
        last = undefined; // nobody heard the gap; the next listener starts from the then-current head
      };
    },
  };
}

/** A store whose accepted runs ring the bell after the transaction committed. */
export function withDoorbell(store: Store, bell: Doorbell): Store {
  /** The commit is done: a ring that fails (head lookup) must not turn the accepted run into an error (WP-841). */
  const ring = (): void => {
    try {
      bell.ring();
    } catch {
      /* the next ring or poll announces the same range */
    }
  };
  return {
    ...store,
    submit(run) {
      const result = store.submit(run);
      if (result.outcome === 'accepted') ring();
      return result;
    },
    submitBatch(runs) {
      const result = store.submitBatch(runs);
      if (result.outcome === 'accepted') ring();
      return result;
    },
  };
}
