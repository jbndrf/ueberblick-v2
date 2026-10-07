/** The device store: writes go to IndexedDB in explicit transactions, then to the memory index. */
import type { Blobs, Facts } from '@ueberblick/core/ports';
import type { CompiledConfigData } from '@ueberblick/core/hydrate';
import type { FeatureId, Key, RecordedObservation, Run, RunId } from '@ueberblick/core/model';
import type { SyncRun } from '@ueberblick/core/sync';
import type { StoreOrigin } from '@ueberblick/core/registry';
import { DeviceStoreError } from './codes';
import type {
  AppendRunsOptions,
  BlobInput,
  DeviceStore,
  StoreChange,
  PageOutcome,
  PageRows,
  Prediction,
  RunEntryInput,
  RunSettlement,
  StoredConfigVersion,
  StoredCursor,
  StoredRun,
  TextSource,
} from './contract';
import { requestResult, runTx } from './idb';
import type { IdbDatabase, IdbEnv } from './idb-types';
import type { MemoryIndex } from './memory';
import { commitPlan, planPage } from './plan';
import { CACHE_STORES, META_KEYS, STORES } from './schema';
import { readRunsForExport, readRunsFrom } from './export';
import { appendRunsTx, removeRunsTx, settleRunsTx } from './runs';
import { toChange, type CommitNotice, type StoreCommit } from './commit';
import { applyNoticeToMirror, type SliceState } from './replica';
import { readLastSynced, readSyncHead, writeLastSynced, writeSyncHead } from './sync-head';
import { readHistory, readRunMeta } from './activity-tx';
import { deleteConfigVersionTx, putConfigVersionTx, readConfigVersionsTx } from './config-versions-tx';
import { clearEvictedTx, dropPredictionTx, putPredictionTx } from './predictions-tx';
import { dropHistoryTx } from './history-gc';
import { hydrate } from './hydrate';
import { writePlan } from './write-plan';
import type { StoreRole } from './roles';
import { isServed } from '@ueberblick/core/registry';

export type { StoreRole } from './roles';

export class DeviceStoreImpl implements DeviceStore {
  state: 'open' | 'unavailable' = 'open';
  readonly facts: Facts;
  readonly blobs: Blobs;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly changeListeners = new Set<(change: StoreChange) => void>();
  /** Replica: a page arriving in slices, after slice `next - 1`. */
  private sliced: SliceState | undefined;
  /** Replica: re-reads of the database under way. The mirror is cleared and half loaded until they end. */
  private rehydrating = 0;
  private readonly commitListeners = new Set<(notice: CommitNotice) => void>();

  constructor(
    private readonly db: IdbDatabase,
    private readonly env: IdbEnv,
    private readonly name: string,
    readonly origin: StoreOrigin,
    private readonly mem: MemoryIndex,
    readonly role: StoreRole = 'writer',
  ) {
    this.facts = {
      feature: (id) => mem.feature(id),
      near: (type, bbox) => mem.near(type, bbox),
      ofType: (type) => mem.ofType(type),
      edgesFrom: (id, relation) => mem.edgesFrom(id, relation),
      edgesTo: (id, relation) => mem.edgesTo(id, relation),
      history: (id, property, limit) => mem.historyOf(id, property, limit),
      // Erasure is planned authoritatively on the server: a device keeps no run attribution (see `Facts`).
      observationsByActor: () => [],
      // Same reason: the sync carries no creator, so a device counts none; the server enforces the quota (WP-639).
      createdBy: () => 0,
      featuresWith: (type, property, value) => {
        const wanted = JSON.stringify(value);
        return [...mem.features.values()].filter(
          (f) =>
            f.type === type && isServed(f.lifecycle) && JSON.stringify(f.properties[property]) === wanted,
        );
      },
    };
    this.blobs = { has: (sha256) => mem.blobKeys.has(sha256) };
  }

  /** Called by the open logic when the connection is lost. */
  markUnavailable(): void {
    this.state = 'unavailable';
  }

  onChange(listener: (change: StoreChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** The writer's committed changes with the cursor before each, for a replica (the sync worker host forwards them). */
  onCommit(listener: (notice: CommitNotice) => void): () => void {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  private emit(from: StoredCursor | undefined, commit: StoreCommit): void {
    for (const l of [...this.commitListeners]) l({ from, commit });
    if (commit.kind !== 'blob_purge') this.notify(toChange(commit));
  }

  private notify(change: StoreChange): void {
    for (const l of [...this.changeListeners]) l(change);
  }

  /** Replica only: applies one notice of the writer (`applyNoticeToMirror`); false when the copy diverged. */
  applyNotice(notice: CommitNotice): boolean {
    this.requireReplica();
    const r = applyNoticeToMirror(this.mem, this.sliced, notice);
    if (!r.applied) return false;
    this.sliced = r.sliced;
    if (r.change) this.notify(r.change);
    return true;
  }

  /**
   * True while the mirror is not a whole, consistent state: a page arriving in slices is half applied, or a
   * re-read of the database (`rehydrate`) is under way, when features may be loaded but the cursor is not.
   * Wait for `onChange` (a `reloaded` after a re-read) before reading (B-012).
   */
  pageInFlight(): boolean {
    return this.sliced !== undefined || this.rehydrating > 0;
  }

  /** Replica only: drops the mirror and re-reads the database in one read transaction. */
  async rehydrate(): Promise<void> {
    this.requireReplica();
    this.sliced = undefined;
    this.mem.clearCache();
    this.mem.blobKeys.clear();
    this.rehydrating++;
    try {
      await hydrate(this.db, this.mem);
    } finally {
      this.rehydrating--;
    }
    this.notify({ kind: 'reloaded' });
  }

  private refuseCacheWrite(): Promise<never> {
    return Promise.reject(
      new DeviceStoreError(
        'not_writer',
        'This store is a read replica; the sync worker is the only writer of the cache.',
      ),
    );
  }

  /** `runs` and `blobs` are queue data: their one writer is the main thread's connection. */
  private refuseQueueWrite(): Promise<never> {
    return Promise.reject(
      new DeviceStoreError('not_writer', 'The sync worker never writes the run queue; the main thread does.'),
    );
  }

  private requireReplica(): void {
    if (this.role === 'replica') return;
    throw new DeviceStoreError('not_writer', 'Only a read replica applies notices.');
  }

  readSyncHead(): Promise<number | undefined> {
    return readSyncHead(this.db);
  }

  writeSyncHead(head: number): Promise<void> {
    return this.serial(() => writeSyncHead(this.db, head));
  }

  readLastSynced = (): Promise<string | undefined> => readLastSynced(this.db);

  writeLastSynced = (at: string | undefined): Promise<void> =>
    this.serial(() => writeLastSynced(this.db, at));

  clearSyncHead(): Promise<void> {
    return this.serial(() => writeSyncHead(this.db, undefined));
  }

  /** Writes are serialised: the plan is computed against committed memory state. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    if (this.state !== 'open')
      return Promise.reject(
        new DeviceStoreError('unavailable', 'The device store is closed; export runs instead.'),
      );
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => undefined);
    return next;
  }

  featureIdsOfType(type: string): readonly FeatureId[] {
    return this.mem.idsOfType(type);
  }

  indexText(type: Key, property: string): void {
    this.mem.indexText(type, property);
  }

  searchText(sources: readonly TextSource[], query: string, limit: number): readonly FeatureId[] {
    return this.mem.searchText(sources, query, limit);
  }

  cursor(): StoredCursor | undefined {
    return this.mem.cursor;
  }

  async warmHistory(ids: readonly FeatureId[]): Promise<void> {
    const cold = ids.filter((id) => !this.mem.isWarm(id));
    if (cold.length === 0) return;
    if (this.state !== 'open') throw new DeviceStoreError('unavailable', 'The device store is closed.');
    const loaded = await readHistory(this.db, this.env, cold);
    for (const [id, rows] of loaded) this.mem.setHistory(id, rows);
  }

  async warmActivity(id: FeatureId): Promise<void> {
    await this.warmHistory([id]);
    const missing = [...new Set(this.mem.observationsOf(id).map((o) => o.runId))].filter(
      (r) => this.mem.activity.run(r) === undefined,
    );
    this.mem.activity.putRuns(await readRunMeta(this.db, missing));
  }

  activityWarm(id: FeatureId): boolean {
    return this.mem.isWarm(id);
  }

  observationsOf(id: FeatureId): readonly RecordedObservation[] {
    return this.mem.observationsOf(id);
  }

  runMeta(runId: RunId): SyncRun | undefined {
    return this.mem.activity.run(runId);
  }

  personName(id: string): string | undefined {
    return this.mem.activity.name(id);
  }
  readonly choosableParticipants = () => this.mem.activity.choosableList();
  readonly choosableHash = () => this.mem.activity.choosableHash();
  readonly plannedChangesOf = (runId: RunId, id: FeatureId) => this.mem.plannedChangesOf(runId, id);
  readonly queuedRunsOf = (id: FeatureId): readonly StoredRun[] => this.mem.queuedOf(id);

  applyPage(rows: PageRows, cursor: StoredCursor): Promise<PageOutcome> {
    if (this.role === 'replica') return this.refuseCacheWrite();
    return this.serial(async () => {
      const plan = planPage(this.mem, rows);
      await writePlan(this.db, this.env, plan, cursor);
      const from = this.mem.cursor;
      commitPlan(this.mem, plan);
      this.mem.cursor = cursor;
      this.emit(from, { kind: 'page', plan, cursor });
      return { featuresWritten: plan.featurePuts.length, staleSkipped: plan.staleSkipped };
    });
  }

  async appendRun(run: Run, blobs: readonly BlobInput[] = []): Promise<number> {
    const [order] = await this.appendRuns([{ run, blobs }]);
    return order ?? -1;
  }

  appendRuns(entries: readonly RunEntryInput[], options: AppendRunsOptions = {}): Promise<readonly number[]> {
    if (this.role === 'cache-writer') return this.refuseQueueWrite();
    return this.serial(async () => {
      const { orders, blobKeys } = await appendRunsTx(this.db, entries, options);
      for (const k of blobKeys) this.mem.blobKeys.add(k);
      this.mem.activity.noteAppended(entries, orders, options);
      return orders;
    });
  }

  settleRuns(settlements: readonly RunSettlement[]): Promise<void> {
    if (this.role === 'cache-writer') return this.refuseQueueWrite();
    return this.serial(async () => {
      await settleRunsTx(this.db, settlements);
      this.mem.activity.noteSettled(settlements);
    });
  }

  removeRuns(runIds: readonly RunId[]): Promise<void> {
    if (this.role === 'cache-writer') return this.refuseQueueWrite();
    return this.serial(async () => {
      await removeRunsTx(this.db, runIds);
      for (const id of runIds) this.mem.activity.removeQueued(id);
    });
  }

  readRuns(): Promise<readonly StoredRun[]> {
    return readRunsFrom(this.db);
  }

  async getBlob(sha256: string): Promise<Uint8Array | undefined> {
    const row = await requestResult(this.db.transaction(STORES.blobs).objectStore(STORES.blobs).get(sha256));
    return (row as { bytes: Uint8Array } | undefined)?.bytes;
  }

  putPrediction(prediction: Prediction): Promise<void> {
    return this.serial(async () => {
      await putPredictionTx(this.db, prediction);
      this.mem.setPrediction(prediction);
    });
  }

  dropPrediction(runId: RunId): Promise<void> {
    return this.serial(async () => {
      await dropPredictionTx(this.db, runId);
      this.mem.removePrediction(runId);
    });
  }

  /**
   * The cache-writer (sync worker) never touches `blobs`: it announces the purge and the main thread applies it
   * (`purgeBlobs`). Every other role applies it here.
   */
  deleteBlob(sha256: string): Promise<void> {
    if (this.role !== 'cache-writer') return this.purgeBlobs([sha256]);
    this.emit(this.mem.cursor, { kind: 'blob_purge', ids: [sha256] });
    return Promise.resolve();
  }

  /**
   * Drops the bytes and key of these blobs, except any a queued run still references (`blobs` is queue data:
   * the check and the delete share one transaction with `appendRun`'s writes). Idempotent. Each blob dropped is
   * heard once as `blob_deleted`.
   */
  purgeBlobs(ids: readonly string[]): Promise<void> {
    if (this.role === 'cache-writer') return this.refuseCacheWrite();
    return this.serial(async () => {
      const dropped: string[] = [];
      await runTx(this.db, [STORES.runs, STORES.blobs], 'readwrite', (tx, guard) => {
        const runs = tx.objectStore(STORES.runs).getAll();
        runs.onsuccess = guard(() => {
          const referenced = new Set<string>();
          for (const r of runs.result as { blobs: readonly string[] }[])
            for (const sha of r.blobs) referenced.add(sha);
          const blobs = tx.objectStore(STORES.blobs);
          for (const sha of ids)
            if (!referenced.has(sha)) {
              blobs.delete(sha);
              dropped.push(sha);
            }
        });
      });
      for (const sha256 of dropped) {
        this.mem.blobKeys.delete(sha256);
        this.notify({ kind: 'blob_deleted', sha256 });
      }
    });
  }

  dropHistory(featureId: FeatureId, properties: readonly string[]): Promise<void> {
    if (this.role === 'replica') return this.refuseCacheWrite();
    return this.serial(async () => {
      await dropHistoryTx(this.db, this.env, featureId, properties);
      this.mem.dropHistoryOf(featureId, properties);
      this.emit(this.mem.cursor, { kind: 'history_dropped', featureId, properties });
    });
  }

  clearCache(): Promise<void> {
    if (this.role === 'replica') return this.refuseCacheWrite();
    return this.serial(async () => {
      await runTx(this.db, [...CACHE_STORES, STORES.meta], 'readwrite', (tx) => {
        for (const s of CACHE_STORES) tx.objectStore(s).clear();
        for (const k of [META_KEYS.cursor, META_KEYS.choosable]) tx.objectStore(STORES.meta).delete(k);
      });
      const from = this.mem.cursor;
      this.mem.clearCache();
      this.emit(from, { kind: 'cleared' });
    });
  }

  acknowledgeEviction(): Promise<void> {
    return this.serial(() => clearEvictedTx(this.db));
  }

  putConfigVersion(version: number, data: CompiledConfigData): Promise<void> {
    return this.serial(() => putConfigVersionTx(this.db, version, data));
  }

  readConfigVersions(): Promise<readonly StoredConfigVersion[]> {
    return readConfigVersionsTx(this.db);
  }

  deleteConfigVersion(version: number): Promise<void> {
    return this.serial(() => deleteConfigVersionTx(this.db, version));
  }

  exportRuns(): Promise<readonly StoredRun[]> {
    return this.state === 'open' ? this.readRuns() : readRunsForExport(this.env, this.name);
  }

  close(): void {
    this.state = 'unavailable';
    this.db.close();
  }
}
