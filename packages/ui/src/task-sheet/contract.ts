// The task sheet contract (WP-526). Written first; the component implements it.
// The sheet wraps the form renderer. It knows no run queue and no storage: both arrive as ports.
import type { Snippet } from 'svelte';
import type { FeatureId, Key, RunId } from '@ueberblick/core/model';
import type { Ids } from '@ueberblick/core/ports';
import type { RunProgressState } from '@ueberblick/core/registry';
import type { Choice, FormModel, Json, SessionOptions, ToolSlot } from '../form/contract';

/** What is handed to the run queue. The queue adds actor and config version (docs/07). */
export interface RunDraft {
  readonly id: RunId;
  readonly task: Key;
  /** Primary feature (`self`); absent for a task that creates one. */
  readonly featureId?: FeatureId;
  /** Values of the relevant fields only (decision 0015). */
  readonly input: { readonly [field: string]: Json };
}

export type RunProgress =
  | { readonly state: Exclude<RunProgressState, 'refused'> }
  | { readonly state: Extract<RunProgressState, 'refused'>; readonly reason: string };

/** Port: implemented by the run queue (WP-511). */
export interface RunSubmitter {
  /** Resolves once the run is durably stored on the device. It never waits for the server. */
  submit(run: RunDraft): Promise<'queued'>;
  /** Calls `listener` with the current progress and on every change. Returns the unsubscribe. */
  outcome(runId: RunId, listener: (progress: RunProgress) => void): () => void;
}

/**
 * A submitter throws this when it refused the run and has already told the person why (its own notice). The form then
 * adds no generic "could not be saved" line; any other thrown error is a real save failure and keeps that line.
 */
export class SubmitRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmitRefusedError';
  }
}

/** Port: the device keeps one draft per key (IndexedDB later). */
export interface DraftStore {
  get(key: string): Promise<Readonly<Record<string, Json>> | undefined>;
  put(key: string, values: Readonly<Record<string, Json>>): Promise<void>;
  drop(key: string): Promise<void>;
}

/** Props of a tool inside the task sheet: the field and the callback that produces its value.
 * Real tools arrive with WP-527. */
export type TaskToolSlot = Pick<ToolSlot, 'field' | 'value' | 'id'> & {
  produce: (value: Json) => void;
};

/** Port: a cancellable timer, so the debounce is deterministic in tests. */
export interface TimerPort {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

/** Quiet time after the last change before the draft is written (phones kill apps without close events). */
export const DRAFT_SAVE_DELAY_MS = 1000;

export interface TaskSheetProps {
  /** Default: `setTimeout`. */
  readonly timer?: TimerPort;
  readonly taskKey: Key;
  readonly model: FormModel;
  /** Compiled project and expression context (`self`, `actor`, `now`, ports); all form rules come from core.form. */
  readonly config: SessionOptions['config'];
  readonly ctx: SessionOptions['ctx'];
  /** The feature type the run targets, when the task is offered on several. */
  readonly type?: SessionOptions['type'];
  /** Ids port: the sheet mints run ids from it (UUIDv7, F1). */
  readonly ids: Pick<Ids, 'runId'>;
  readonly submitter: RunSubmitter;
  readonly drafts: DraftStore;
  /** Draft key. Default: the task key plus the target features, so each target has its own draft. */
  readonly draftKey?: string;
  /** Primary features. None: a task that creates one. Several (H2): one run per feature. */
  readonly featureIds?: readonly FeatureId[];
  /** Prefill from an assistant proposal (H4) or a role preset. A stored draft wins over it. */
  readonly initial?: Readonly<Record<string, Json>>;
  readonly locale?: string;
  readonly online: boolean;
  readonly choices?: Readonly<Record<string, readonly Choice[]>>;
  /** Renders the tool of a field with a `tool` key. */
  readonly tool?: Snippet<[TaskToolSlot]>;
  /** Called by the form's "Abbrechen" (first page; the draft is kept) and by the "Close" button after a submit. */
  readonly onclose?: () => void;
}

export type { FormModel };
