/**
 * The device run queue (docs/07 "Run queue (device)", contract: `contract.ts`). Runs are stored before anything
 * else, predicted, sent one entry at a time, and rebased on refusal. The store is the source of truth: the
 * in-memory `rows` are a cache that `reload()` refreshes after every operation.
 */
import type { Instant, Run, RunId, Seq } from '@ueberblick/core/model';
import { isRefusedRunState } from '@ueberblick/core/registry';
import type { BlobInput, StoredRun } from '../store';
import type {
  DrainResult,
  EnqueueResult,
  QueueStatus,
  RefusedRun,
  ReviewRun,
  RunBlobs,
  RunQueue,
  RunQueueDeps,
} from './contract';
import { DEFAULT_BACKOFF, QueueError } from './contract';
import { drainLocked, rebuild, reconcile, rememberCreated, type Ctx, type QueueState } from './engine';
import { toEntries } from './entries';
import { createPlanner } from './planner';

const ageMs = (now: Instant, then: Instant | undefined): number | undefined => {
  if (then === undefined) return undefined;
  const d = Date.parse(now) - Date.parse(then);
  return Number.isNaN(d) ? undefined : Math.max(0, d);
};

function validate(batch: readonly Run[]): void {
  const first = batch[0];
  if (first === undefined) throw new QueueError('invalid_batch', 'A batch needs at least one run.');
  if (new Set(batch.map((r) => r.id)).size !== batch.length)
    throw new QueueError('invalid_batch', 'The runs of a batch need distinct ids.');
  if (batch.some((r) => r.configVersion !== first.configVersion))
    throw new QueueError('invalid_batch', 'The runs of a batch share one config version.');
}

export async function createRunQueue(deps: RunQueueDeps): Promise<RunQueue> {
  const { store, clock, ids } = deps;
  const state: QueueState = {
    rows: [],
    sending: undefined,
    hold: undefined,
    failures: 0,
    nextAt: 0,
    awaitingConfig: [],
    unpredicted: new Set(),
    serverProtocol: undefined,
    syncedSeq: -1,
    created: new Map(),
  };
  const listeners = new Set<(s: QueueStatus) => void>();
  let exclusiveTail: Promise<void> = Promise.resolve();
  const ctx: Ctx = {
    deps,
    planner: createPlanner(deps),
    state,
    async reload() {
      state.rows = await store.readRuns();
    },
    exclusive(fn) {
      const run = exclusiveTail.then(fn, fn);
      exclusiveTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    emit() {
      const s = status();
      listeners.forEach((l) => l(s));
      rearm();
    },
  };

  // The self-retry: one timer, armed only while the hold is `backoff`, keyed by the `nextAt` it was armed for.
  let retry: { readonly handle: unknown; readonly nextAt: number } | undefined;
  let closed = false;
  function disarm(): void {
    if (retry !== undefined) deps.timers.clear(retry.handle);
    retry = undefined;
  }
  /** `minMs` keeps a retry that found the queue busy (another tab) from firing in a tight loop. */
  function rearm(minMs = 0): void {
    if (closed || state.hold !== 'backoff') return disarm();
    if (retry?.nextAt === state.nextAt && minMs === 0) return;
    disarm();
    const nextAt = state.nextAt;
    const ms = Math.max(minMs, nextAt - deps.mono());
    const handle = deps.timers.set(() => {
      retry = undefined;
      drain()
        .then((r) => rearm(r.busy ? (deps.backoff ?? DEFAULT_BACKOFF).baseMs : 0))
        .catch((e: unknown) => deps.onError(e));
    }, ms);
    retry = { handle, nextAt };
  }

  function status(): QueueStatus {
    const entries = toEntries(state.rows);
    const queued = state.rows.filter((r) => r.state === 'queued');
    const head = entries.find((e) => e.state === 'queued')?.runs[0];
    const refused: RefusedRun[] = state.rows
      .filter((r) => isRefusedRunState(r.state) && r.refusal !== undefined)
      .map((r) => ({
        runId: r.run.id,
        task: r.run.task,
        refusal: r.refusal as NonNullable<StoredRun['refusal']>,
        input: r.run.input,
      }));
    const review: ReviewRun[] = state.rows
      .filter((r) => r.state === 'review')
      .map((r) => ({ runId: r.run.id, task: r.run.task, configVersion: r.run.configVersion }));
    return {
      pending: queued.length,
      awaitingPull: state.rows.filter((r) => r.state === 'accepted').length,
      oldestPendingAgeMs: ageMs(clock.now(), head?.run.clientTime),
      sending: state.sending,
      refused,
      review,
      hold: state.hold,
      awaitingConfig: state.awaitingConfig,
      serverProtocol: state.hold === 'incompatible_protocol' ? state.serverProtocol : undefined,
      unpredicted: [...state.unpredicted],
      retryInMs: state.hold === 'backoff' ? Math.max(0, state.nextAt - deps.mono()) : undefined,
    };
  }

  async function submit(batch: readonly Run[], blobs: RunBlobs = {}): Promise<EnqueueResult> {
    validate(batch);
    const stamped = batch.map((r) => (r.clientTime === undefined ? { ...r, clientTime: clock.now() } : r));
    const entries = stamped.map((run) => ({ run, ...(blobs[run.id] ? { blobs: blobs[run.id] } : {}) }));
    const group = stamped.length > 1 ? (stamped[0] as Run).id : undefined;
    const planned = await ctx.planner.plan(stamped);
    if (planned.kind === 'config')
      throw new QueueError(
        'config_unavailable',
        `Config version ${planned.version} is not on this device yet.`,
      );
    try {
      if (planned.kind === 'refused') {
        await store.appendRuns(entries, {
          state: 'refused',
          refusal: planned.refusal,
          ...(group !== undefined ? { group } : {}),
        });
        return { ok: false, runId: planned.runId, refusal: planned.refusal };
      }
      const orders = await store.appendRuns(entries, group !== undefined ? { group } : {});
      for (const p of planned.predictions) await store.putPrediction(p);
      rememberCreated(state, planned.created);
      return { ok: true, orders, created: planned.created };
    } finally {
      await ctx.reload();
      ctx.emit();
    }
  }

  let inFlight: Promise<DrainResult> | undefined;
  const drain = (): Promise<DrainResult> => {
    inFlight ??= deps.lock
      .tryRun(() => drainLocked(ctx))
      .then((r) => (r.ran ? r.value : { accepted: 0, refused: 0, review: 0, hold: state.hold, busy: true }))
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  /** The run and its atomic batch. Resubmit takes only refused or review runs; discard also a waiting one that is not in flight. */
  const findGroup = (rows: readonly StoredRun[], runId: RunId, waitingToo: boolean): readonly StoredRun[] => {
    const row = rows.find((r) => r.run.id === runId);
    if (row === undefined) throw new QueueError('not_found', `No run ${runId} on this device.`);
    const group = row.group === undefined ? [row] : rows.filter((r) => r.group === row.group);
    const settled = isRefusedRunState(row.state) || row.state === 'review';
    const waiting = row.state === 'queued' && !group.some((r) => r.run.id === state.sending);
    if (!settled && !(waitingToo && waiting))
      throw new QueueError(
        'not_discardable',
        waitingToo
          ? 'Only a refused, review or waiting run that is not being sent can be discarded.'
          : 'Only a refused or review run can be resubmitted.',
      );
    return group;
  };

  const busy = (): QueueError =>
    new QueueError(
      'not_discardable',
      'The queue is sending right now (here or in another tab); try again when it has settled.',
    );

  const queue: RunQueue = {
    enqueue: (run, blobs) => submit([run], blobs ? { [run.id]: blobs } : {}),
    submit,
    drain,
    status,
    createdBy: (runId) => state.created.get(runId) ?? [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resetBackoff() {
      state.failures = 0;
      state.nextAt = 0;
      if (state.hold === 'backoff' || state.hold === 'auth_expired') state.hold = undefined;
      ctx.emit();
    },
    close() {
      closed = true;
      disarm();
    },
    async onPulled(seq: Seq) {
      state.syncedSeq = Math.max(state.syncedSeq, seq);
      await ctx.reload();
      await reconcile(ctx);
      ctx.emit();
    },
    async discard(runId) {
      // Under the cross-tab lock: no send (this tab or another) can run while the run and its predictions go.
      const r = await deps.lock.tryRun(async () => {
        if (state.sending !== undefined) throw busy();
        await ctx.reload();
        const group = findGroup(state.rows, runId, true);
        const wasQueued = group.some((g) => g.state === 'queued');
        for (const row of group) await store.dropPrediction(row.run.id);
        await store.removeRuns(group.map((g) => g.run.id));
        for (const sha of new Set(group.flatMap((g) => g.blobs))) await store.deleteBlob(sha); // keeps bytes another run references
        await ctx.reload();
        if (wasQueued) await rebuild(ctx, true); // later waiting runs no longer build on the dropped one
        ctx.emit();
      });
      if (!r.ran) throw busy();
    },
    async resubmit(runId) {
      await ctx.reload();
      const group = findGroup(state.rows, runId, false);
      const blobs: Record<string, readonly BlobInput[]> = {};
      const fresh = await Promise.all(
        group.map(async (row) => {
          const id = ids.runId();
          const loaded: BlobInput[] = [];
          for (const sha256 of row.blobs) {
            const bytes = await store.getBlob(sha256);
            const mime = row.blobMimes[sha256];
            if (bytes !== undefined && mime !== undefined) loaded.push({ sha256, bytes, mime });
          }
          blobs[id] = loaded;
          const { task, actor, configVersion, featureId, input } = row.run;
          return { id, task, actor, configVersion, input, ...(featureId !== undefined ? { featureId } : {}) };
        }),
      );
      const result = await submit(fresh, blobs);
      await store.removeRuns(group.map((r) => r.run.id));
      await ctx.reload();
      ctx.emit();
      // Like a new local run (v3 resendTaskRun -> notifyLocalWrite): send at once. Offline, the attempt fails
      // transiently and the run waits for the next trigger.
      if (result.ok) drain().catch(deps.onError);
      return result;
    },
    async exportQueue() {
      const rows = await store.exportRuns();
      return JSON.stringify({ exportedAt: clock.now(), runs: rows }, null, 2);
    },
    async rederive() {
      await ctx.exclusive(async () => {
        await ctx.reload();
        await rebuild(ctx, false);
      });
      ctx.emit();
    },
  };

  await ctx.reload();
  if (state.rows.some((r) => r.state === 'queued' || r.state === 'accepted')) await rebuild(ctx, false);
  return queue;
}
