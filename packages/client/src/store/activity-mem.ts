/**
 * In-memory side of the Aktivität data (WP-602): run rows (a bounded cache, reloaded on `warmActivity`), the
 * names the sync shipped, and the queued runs of the device (a handful, mirrored so the reader stays synchronous).
 */
import type { FeatureId, RunId } from '@ueberblick/core/model';
import { choosableHash, type SyncPerson, type SyncRun } from '@ueberblick/core/sync';
import type { AppendRunsOptions, Prediction, RunEntryInput, RunSettlement, StoredRun } from './contract';
import { toStoredRun } from './runs';

/** Run rows kept in memory; older ones reload from IndexedDB on `warmActivity`. */
export const RUN_META_CACHE = 20_000;

export class ActivityIndex {
  private readonly runs = new Map<RunId, SyncRun>();
  private readonly names = new Map<string, string>();
  private readonly choosable = new Map<string, string>();
  private hash: string | undefined;
  private readonly queued = new Map<RunId, StoredRun>();

  putRuns(rows: readonly SyncRun[]): void {
    for (const r of rows) {
      this.runs.delete(r.id);
      this.runs.set(r.id, r);
    }
    // one pass over the oldest keys: restarting `keys().next()` after each delete walks the deleted slots (quadratic)
    let excess = this.runs.size - RUN_META_CACHE;
    if (excess <= 0) return;
    const old: RunId[] = [];
    for (const id of this.runs.keys()) {
      if (excess-- <= 0) break;
      old.push(id);
    }
    for (const id of old) this.runs.delete(id);
  }

  putPeople(rows: readonly SyncPerson[]): void {
    for (const p of rows) if (p.name !== '') this.names.set(p.id, p.name);
  }

  /** Replaces the choosable set (WP-725): a participant the server left out is gone. */
  setChoosable(rows: readonly { readonly id: string; readonly name: string }[]): void {
    this.choosable.clear();
    this.hash = undefined;
    for (const p of rows) this.choosable.set(p.id, p.name);
  }

  choosableHash(): string {
    this.hash ??= choosableHash(this.choosableList());
    return this.hash;
  }

  /** The participants the receiver may choose for a participant property (WP-725), by name, unnamed last. */
  choosableList(): readonly { readonly id: string; readonly name: string }[] {
    return [...this.choosable]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) =>
        a.name === b.name
          ? a.id < b.id
            ? -1
            : 1
          : a.name === ''
            ? 1
            : b.name === ''
              ? -1
              : a.name.localeCompare(b.name),
      );
  }

  run(id: RunId): SyncRun | undefined {
    return this.runs.get(id);
  }

  name(id: string): string | undefined {
    return this.names.get(id);
  }

  /** The synced data is a cache: `clearCache` drops it. The queue is not a cache. */
  clearSynced(): void {
    this.runs.clear();
    this.names.clear();
    this.choosable.clear();
    this.hash = undefined;
  }

  setQueued(run: StoredRun): void {
    this.queued.set(run.run.id, run);
  }

  hasQueued(id: RunId): boolean {
    return this.queued.has(id);
  }

  removeQueued(id: RunId): void {
    this.queued.delete(id);
  }

  queuedRun(id: RunId): StoredRun | undefined {
    return this.queued.get(id);
  }

  /** Mirrors what `appendRuns` stored: entries already mirrored keep their row. */
  noteAppended(
    entries: readonly RunEntryInput[],
    orders: readonly number[],
    options: AppendRunsOptions,
  ): void {
    entries.forEach((entry, i) => {
      if (this.queued.has(entry.run.id)) return;
      const blobs = entry.blobs ?? [];
      this.setQueued(
        toStoredRun({
          order: orders[i] ?? -1,
          runId: entry.run.id,
          run: entry.run,
          blobs: blobs.map((b) => b.sha256),
          blobMimes: Object.fromEntries(blobs.map((b) => [b.sha256, b.mime] as const)),
          state: options.state ?? 'queued',
          ...(options.group !== undefined ? { group: options.group } : {}),
          ...(options.refusal !== undefined ? { refusal: options.refusal } : {}),
        }),
      );
    });
  }

  /** Mirrors `settleRuns`: the new state replaces the old refusal and accepted seq. */
  noteSettled(settlements: readonly RunSettlement[]): void {
    for (const s of settlements) {
      const row = this.queued.get(s.runId);
      if (row === undefined) continue;
      this.setQueued({
        order: row.order,
        run: row.run,
        blobs: row.blobs,
        blobMimes: row.blobMimes,
        state: s.state,
        ...((s.uploaded ?? row.uploaded) ? { uploaded: s.uploaded ?? row.uploaded } : {}),
        ...(row.group !== undefined ? { group: row.group } : {}),
        ...(s.refusal !== undefined ? { refusal: s.refusal } : {}),
        ...(s.acceptedSeq !== undefined ? { acceptedSeq: s.acceptedSeq } : {}),
      });
    }
  }

  /** Queued runs on `featureId` (named by the run or touched by its prediction), oldest first. */
  queuedOf(featureId: FeatureId, predictions: Iterable<Prediction>): readonly StoredRun[] {
    const touched = new Set<RunId>();
    for (const p of predictions) if (p.features.some((f) => f.id === featureId)) touched.add(p.runId);
    return [...this.queued.values()]
      .filter((r) => r.run.featureId === featureId || touched.has(r.run.id))
      .sort((a, b) => a.order - b.order);
  }
}
