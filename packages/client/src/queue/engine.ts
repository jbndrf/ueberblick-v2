/**
 * The queue's moving parts: re-planning (rebase and re-derivation), reconciliation with pulls, and the
 * sequential drain. Every decision reads the store fresh (`ctx.reload()`), so a second tab's changes are seen.
 */
import type { FeatureId, Refusal, RunId, Seq } from '@ueberblick/core/model';
import { isRefusedRunState, type QueueHold } from '@ueberblick/core/registry';
import type { StoredRun } from '../store';
import type {
  BackoffOptions,
  BatchResponse,
  DrainResult,
  RunPayload,
  RunQueueDeps,
  RunReply,
  RunResponse,
} from './contract';
import { DEFAULT_BACKOFF, DEFAULT_SEND_TIMEOUT_MS } from './contract';
import { idsOf, payloadOf, toEntries, type Entry } from './entries';
import type { CreatedByRun, Planner } from './planner';
import { uploadEntry } from './upload';

export interface QueueState {
  rows: readonly StoredRun[];
  sending: RunId | undefined;
  hold: QueueHold | undefined;
  failures: number;
  nextAt: number;
  awaitingConfig: readonly number[];
  /** Runs of live entries that have no prediction right now. Loud, never silent. */
  unpredicted: Set<RunId>;
  serverProtocol: number | undefined;
  /** The highest seq a pull reached (fed by `onPulled`). */
  syncedSeq: Seq;
  /** What each run's last plan created. Insertion order; the oldest go first (`CREATED_KEPT`). */
  created: Map<RunId, readonly FeatureId[]>;
}

/** Runs remembered: enough for the form that just submitted one, small enough to never matter. */
const CREATED_KEPT = 200;

export function rememberCreated(state: QueueState, created: CreatedByRun): void {
  for (const [id, ids] of Object.entries(created)) {
    state.created.delete(id as RunId);
    state.created.set(id as RunId, ids);
  }
  for (const id of state.created.keys()) {
    if (state.created.size <= CREATED_KEPT) break;
    state.created.delete(id);
  }
}

export interface Ctx {
  readonly deps: RunQueueDeps;
  readonly planner: Planner;
  readonly state: QueueState;
  reload(): Promise<void>;
  emit(): void;
  /**
   * Runs `fn` after every earlier `exclusive` call has settled. What changes the stored runs and their predictions
   * (a settled reply, a refusal, a re-derivation after a sync reset) goes through here, so a re-derivation never
   * re-plans entries from rows a refusal has just settled (it would put the refused create's Objekt back).
   */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
}

const live = (e: Entry) => e.state === 'queued' || e.state === 'accepted';

/** The refusal an atomic batch's runs all carry: the culprit's. */
async function refuseEntry(
  ctx: Ctx,
  entry: Entry,
  refusal: Refusal,
  state: 'refused' | 'dependent' = 'refused',
): Promise<void> {
  await ctx.deps.store.settleRuns(idsOf(entry).map((runId) => ({ runId, state, refusal })));
  await ctx.reload();
}

/** A feature whose creating run was refused, with that run and its refusal: runs on it depend on the refusal. */
interface Culprit {
  readonly runId: RunId;
  readonly refusal: Refusal;
}
type Lost = ReadonlyMap<FeatureId, Culprit>;

function lostFeatures(ctx: Ctx): Map<FeatureId, Culprit> {
  const lost = new Map<FeatureId, Culprit>();
  for (const r of ctx.state.rows) {
    if (!isRefusedRunState(r.state) || r.refusal === undefined) continue;
    for (const f of ctx.state.created.get(r.run.id) ?? [])
      lost.set(f, { runId: r.run.id, refusal: r.refusal });
  }
  return lost;
}

/** The refusal a dependent run carries: the culprit's, with its run id in the developer message. */
const dependentRefusal = (culprit: Culprit): Refusal => ({
  ...culprit.refusal,
  message: `depends on refused run ${culprit.runId}: ${culprit.refusal.message}`,
});

const culpritOf = (lost: Lost, entry: Entry): Culprit | undefined => {
  for (const r of entry.runs) {
    const hit = r.run.featureId === undefined ? undefined : lost.get(r.run.featureId);
    if (hit !== undefined) return hit;
  }
  return undefined;
};

/**
 * Plans entries again in order over the current state and replaces their predictions.
 * - `refuse` (rebase after a refusal): only QUEUED entries are re-planned, and one that now fails is refused.
 *   Accepted entries keep their prediction: they were sent after every earlier entry had settled, so their
 *   prediction is already current, and re-planning them can only lose confirmed effects.
 * - otherwise (`rederive`, after a sync reset the base moved): every live entry is re-planned; one that now
 *   fails stays queued without a prediction and the server decides. Such runs are listed in
 *   `QueueStatus.unpredicted` (never silently dropped).
 * Returns the number of runs refused.
 */
export async function rebuild(ctx: Ctx, refuse: boolean): Promise<number> {
  const { store } = ctx.deps;
  let refused = 0;
  const entries = toEntries(ctx.state.rows).filter((e) => (refuse ? e.state === 'queued' : live(e)));
  const lost = refuse ? lostFeatures(ctx) : new Map<FeatureId, Culprit>();
  for (const e of entries) for (const id of idsOf(e)) await store.dropPrediction(id);
  for (const e of entries) {
    const out = await ctx.planner.plan(e.runs.map((r) => r.run));
    if (out.kind === 'ok') {
      for (const id of idsOf(e)) ctx.state.unpredicted.delete(id);
      for (const p of out.predictions) await store.putPrediction(p);
      rememberCreated(ctx.state, out.created);
    } else if (out.kind === 'refused' && refuse) {
      // a run on a feature whose create was refused depends on that refusal (v3 `dependent_rejected`)
      const culprit = culpritOf(lost, e);
      if (culprit === undefined) {
        await refuseEntry(ctx, e, out.refusal);
        for (const id of idsOf(e)) ctx.state.created.delete(id);
      } else {
        await refuseEntry(ctx, e, dependentRefusal(culprit), 'dependent');
        for (const r of e.runs) for (const f of ctx.state.created.get(r.run.id) ?? []) lost.set(f, culprit); // chains follow the first culprit
      }
      refused += e.runs.length;
    } else {
      for (const id of idsOf(e)) ctx.state.unpredicted.add(id);
    }
  }
  const held = new Set(ctx.state.rows.map((r) => r.run.id));
  for (const id of ctx.state.unpredicted) if (!held.has(id)) ctx.state.unpredicted.delete(id);
  await ctx.reload();
  return refused;
}

/** Accepted runs a pull has covered lose their prediction and leave the queue. */
export async function reconcile(ctx: Ctx): Promise<void> {
  const { store } = ctx.deps;
  const covered = ctx.state.rows.filter(
    (r) => r.state === 'accepted' && r.acceptedSeq !== undefined && r.acceptedSeq <= ctx.state.syncedSeq,
  );
  if (covered.length === 0) return;
  const ids = covered.map((r) => r.run.id);
  for (const id of ids) await store.dropPrediction(id);
  await store.removeRuns(ids);
  await ctx.reload();
}

function withTimeout(ctx: Ctx, send: () => Promise<RunReply>): Promise<RunReply> {
  const { timers } = ctx.deps;
  const ms = ctx.deps.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
  return new Promise<RunReply>((resolve) => {
    const handle = timers.set(() => resolve({ kind: 'transient', reason: 'timeout' }), ms);
    Promise.resolve()
      .then(send)
      .then(
        (reply) => {
          timers.clear(handle);
          resolve(reply);
        },
        (error: unknown) => {
          timers.clear(handle);
          resolve({ kind: 'transient', reason: error instanceof Error ? error.message : String(error) });
        },
      );
  });
}

const seqOf = (response: RunResponse | BatchResponse, runId: string): Seq | undefined => {
  if (response.outcome !== 'accepted') return undefined;
  if ('results' in response)
    return response.results.find((r) => r.runId === runId)?.seq.to ?? response.seq.to;
  return response.seq.to;
};

/** A reply names the run (single) or the runs (batch) it answers; anything else is not ours to act on. */
function answers(entry: Entry, payload: RunPayload, response: RunResponse | BatchResponse): boolean {
  if (payload.kind === 'run') return 'runId' in response && response.runId === entry.runs[0]?.run.id;
  if (response.outcome === 'accepted')
    return 'results' in response && response.results.length === entry.runs.length;
  return response.runId !== undefined && idsOf(entry).includes(response.runId as RunId);
}

const delayOf = (b: BackoffOptions, failures: number): number =>
  Math.min(b.capMs, b.baseMs * 2 ** Math.max(0, failures - 1));

interface Counts {
  accepted: number;
  refused: number;
  review: number;
}

/** Settles one entry with the typed answer and rebases what follows. Returns false when the reply is not for it. */
async function settle(
  ctx: Ctx,
  entry: Entry,
  payload: RunPayload,
  response: RunResponse | BatchResponse,
  counts: Counts,
): Promise<boolean> {
  const { store } = ctx.deps;
  if (!answers(entry, payload, response)) return false;
  const ids = idsOf(entry);
  if (response.outcome === 'accepted') {
    await store.settleRuns(
      entry.runs.map((r) => ({
        runId: r.run.id,
        state: 'accepted' as const,
        ...(seqOf(response, r.run.id) !== undefined ? { acceptedSeq: seqOf(response, r.run.id) as Seq } : {}),
      })),
    );
    counts.accepted += ids.length;
    await ctx.reload();
    await reconcile(ctx);
    return true;
  }
  if (response.outcome === 'refused') {
    await refuseEntry(ctx, entry, response.refusal);
    counts.refused += ids.length;
  } else {
    await store.settleRuns(ids.map((runId) => ({ runId, state: 'review' as const })));
    counts.review += ids.length;
    await ctx.reload();
  }
  for (const id of ids) await store.dropPrediction(id);
  counts.refused += await rebuild(ctx, true);
  return true;
}

/** Sends live queued entries one at a time, in order, until one is not settled. Holds the cross-tab lock. */
export async function drainLocked(ctx: Ctx): Promise<DrainResult> {
  const { state, deps } = ctx;
  const counts: Counts = { accepted: 0, refused: 0, review: 0 };
  const result = (): DrainResult => ({ ...counts, hold: state.hold, busy: false });
  await ctx.reload();
  if (state.hold === 'incompatible_protocol') return result(); // never retried: the app must be updated
  if (state.hold === 'backoff' && deps.mono() < state.nextAt) return result();
  for (;;) {
    const head = toEntries(state.rows).find((e) => e.state === 'queued');
    if (head === undefined) {
      state.hold = undefined;
      state.awaitingConfig = [];
      break;
    }
    if (deps.config.get(head.version) === 'refetching') {
      state.hold = 'awaiting_config';
      state.awaitingConfig = [head.version];
      break;
    }
    state.awaitingConfig = [];
    const payload = payloadOf(head);
    state.sending = head.runs[0]?.run.id;
    ctx.emit();
    const uploaded = await uploadEntry(deps.store, deps.blobTransport, head, (runId, done) => {
      // The in-memory rows follow the stored ones, so the next attempt of this entry skips what arrived.
      state.rows = state.rows.map((r) => (r.run.id === runId ? { ...r, uploaded: done } : r));
    });
    if (uploaded.kind === 'refused') {
      state.sending = undefined;
      const { refusal } = uploaded;
      await ctx.exclusive(async () => {
        const ids = idsOf(head);
        await refuseEntry(ctx, head, refusal);
        counts.refused += ids.length;
        for (const id of ids) await deps.store.dropPrediction(id);
        counts.refused += await rebuild(ctx, true);
      });
      state.failures = 0;
      state.hold = undefined;
      ctx.emit();
      continue;
    }
    const reply: RunReply =
      uploaded.kind === 'transient'
        ? { kind: 'transient', reason: uploaded.reason }
        : await withTimeout(ctx, () => deps.transport.send(payload));
    state.sending = undefined;
    if (reply.kind === 'unauthenticated') {
      state.hold = 'auth_expired';
      break;
    }
    if (reply.kind === 'incompatible') {
      state.hold = 'incompatible_protocol';
      state.serverProtocol = reply.v;
      break;
    }
    if (
      reply.kind === 'response' &&
      (await ctx.exclusive(() => settle(ctx, head, payload, reply.response, counts)))
    ) {
      state.failures = 0;
      state.hold = undefined;
      ctx.emit();
      continue;
    }
    // transient (or a typed reply that is not for this entry): back off, lose nothing
    state.failures++;
    state.nextAt = deps.mono() + delayOf(deps.backoff ?? DEFAULT_BACKOFF, state.failures);
    state.hold = 'backoff';
    break;
  }
  ctx.emit();
  return result();
}
