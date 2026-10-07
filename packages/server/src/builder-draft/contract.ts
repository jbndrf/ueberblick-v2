/** One row of `builder_draft` (A-011): the overlay being edited, pinned to a template version. */
export interface Draft {
  readonly template: string;
  readonly templateVersion: string;
  /** The overlay source text. It may not compile: a draft in progress is allowed to be broken. */
  readonly overlay: string;
  /** Counts accepted writes, starting at 1. A write names the revision it started from. */
  readonly revision: number;
  readonly updatedBy: string | null;
  readonly updatedAt: string;
}

export interface NewDraft {
  readonly template: string;
  readonly templateVersion: string;
  readonly overlay: string;
  readonly by: string;
  readonly at: string;
}

/** A refused write carries the draft as it is now, so the caller can show what changed elsewhere. */
export type PutResult =
  { readonly ok: true; readonly draft: Draft } | { readonly ok: false; readonly draft: Draft | undefined };

/**
 * The port for the working draft of one project. Keyed by the project database today; a later
 * `name` argument (named drafts, A-011 option B) is additive.
 */
export interface DraftStore {
  get(): Draft | undefined;
  /** Stores the first draft when none exists; returns the stored draft either way. */
  seed(draft: NewDraft): Draft;
  /**
   * Replaces the draft with a new base (template upgrade): template, version and overlay are overwritten and the
   * revision advances, so an editor still holding the old revision is refused. Creates the draft when none exists.
   */
  reset(draft: NewDraft): Draft;
  /** Compare-and-swap: stores `overlay` and increments the revision only when `expected` is the current one. */
  putIf(expected: number, overlay: string, by: string, at: string): PutResult;
}
