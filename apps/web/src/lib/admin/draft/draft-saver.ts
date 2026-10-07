/**
 * Saves the builder's overlay to the draft (A-011): one write in flight, the latest overlay wins,
 * every write names the revision it started from. A stale answer (409) stops saving until the page
 * is reloaded, so nothing is overwritten silently. Pure logic, no DOM: the layout wires `fetch`.
 */
export const SAVE_STATES = ['saved', 'saving', 'conflict', 'error'] as const;
export type SaveState = (typeof SAVE_STATES)[number];

export type PutOutcome =
  | { readonly kind: 'saved'; readonly revision: number }
  | { readonly kind: 'stale' }
  | { readonly kind: 'failed' };

export interface DraftSaverOptions {
  /** The revision the page opened the draft at. */
  readonly revision: number;
  put(overlay: string, revision: number): Promise<PutOutcome>;
  onstate(state: SaveState): void;
}

export interface DraftSaver {
  save(overlay: string): void;
  /** Resolves once every accepted edit has been written (or the write failed or conflicted). */
  settled(): Promise<void>;
  /** The revision of the last accepted write, or the one the page opened at. */
  revision(): number;
  /** True after a 409: the draft was changed elsewhere and nothing more is saved. */
  conflicted(): boolean;
}

export function createDraftSaver(opts: DraftSaverOptions): DraftSaver {
  let revision = opts.revision;
  let inflight = false;
  let pending: string | undefined;
  let conflict = false;
  let running: Promise<void> = Promise.resolve();

  async function flush(): Promise<void> {
    inflight = true;
    opts.onstate('saving');
    while (pending !== undefined && !conflict) {
      const overlay = pending;
      pending = undefined;
      const r = await opts.put(overlay, revision);
      if (r.kind === 'saved') revision = r.revision;
      else {
        conflict = r.kind === 'stale';
        pending = undefined;
        inflight = false;
        opts.onstate(conflict ? 'conflict' : 'error');
        return;
      }
    }
    inflight = false;
    opts.onstate(conflict ? 'conflict' : 'saved');
  }

  return {
    save(overlay) {
      if (conflict) return;
      pending = overlay;
      if (!inflight) running = flush();
    },
    async settled() {
      await running;
    },
    revision: () => revision,
    conflicted: () => conflict,
  };
}
