/**
 * The one sync engine (docs/07). `pull()` runs a snapshot or a delta to the end of the server's data.
 * Every page is applied with its cursor in one store transaction, so a crash resumes exactly. The next
 * page is requested while the current one is written. Predictions are never touched by a pull.
 */
import { SYNC_PROTOCOL_VERSION, SyncProtocolError, parseRedactionKey } from '@ueberblick/core/sync';
import type { Seq } from '@ueberblick/core/model';
import type { SyncPage, SyncTombstone, SyncRequest, SyncVersions } from '@ueberblick/core/sync';
import type { SyncPhase, SyncResetReason } from '@ueberblick/core/registry';
import { DeviceStoreError } from '../store/codes';
import type { PageRows, StoredCursor } from '../store';
import type { PullResult, SyncFailure, SyncEngine, SyncStatus, SyncWorkerDeps } from './contract';

/** More restarts than this in one pull means the server keeps changing its mind; stop loudly. */
const MAX_RESTARTS = 3;

interface Counts {
  pages: number;
}

class Restart {
  constructor(readonly reason: SyncResetReason) {}
}

export function classify(error: unknown): SyncFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SyncProtocolError) return { kind: 'protocol', code: error.code, message };
  if (error instanceof DeviceStoreError) return { kind: 'store', code: error.code, message };
  return { kind: 'transport', code: undefined, message };
}

export function createSyncWorker(deps: SyncWorkerDeps): SyncEngine {
  const { store, transport, meta, predictions, clock, config } = deps;
  let versions: SyncVersions | undefined;
  let status: SyncStatus = {
    phase: 'idle',
    lastSyncedAt: undefined,
    lastSyncedSeq: undefined,
    lastError: undefined,
    featuresLoaded: 0,
  };
  const listeners = new Set<(s: SyncStatus) => void>();
  const setStatus = (patch: Partial<SyncStatus>) => {
    status = { ...status, ...patch };
    listeners.forEach((l) => l(status));
  };
  let inFlight: Promise<PullResult> | undefined;
  let rerun = false;
  // the last `header.access` seen (WP-793); the first one is the baseline, a later different one is a change
  let lastAccess: string | undefined;
  let accessChanged = false;

  /** One pass from the stored cursor to the end of the server's data. Throws `Restart` to start over. */
  async function drive(counts: Counts): Promise<Seq> {
    const stored = store.cursor();
    const state = await meta.read();
    if (stored?.kind === 'snapshot' && !state) throw new Restart('snapshot_restart');
    const snapshot = !stored || stored.kind === 'snapshot';
    const phase: SyncPhase = snapshot ? 'snapshot' : 'delta';
    setStatus({ phase, ...(snapshot && !stored ? { featuresLoaded: 0 } : {}) });

    let scope = stored?.scopeFingerprint ?? '';
    let position: Seq = stored?.cursor ?? 0;
    let pin: Seq | undefined = stored?.kind === 'snapshot' ? state?.head : undefined;
    // the hash of the choosable set the device holds: the server ships the list only when it differs (WP-725)
    const held = (): { choosable?: string } => {
      const choosable = store.choosableHash();
      return choosable === '' ? {} : { choosable };
    };
    const first: SyncRequest =
      snapshot && stored && pin !== undefined
        ? { since: 0, scope, v: PROTOCOL, after: position, pin, ...held() }
        : { since: snapshot ? 0 : position, scope, v: PROTOCOL, ...held() };
    let pending: Promise<SyncPage> = transport.fetchPage(first);
    for (;;) {
      const page = await pending;
      const { header } = page;
      if (config) {
        config.follow(header.versions);
        versions = header.versions;
      }
      if (header.access !== undefined) {
        if (lastAccess !== undefined && lastAccess !== header.access) accessChanged = true;
        lastAccess = header.access;
      }
      const head = header.head;
      if (snapshot) {
        if (header.kind !== 'snapshot')
          throw new SyncProtocolError('malformed', 'a snapshot request returned a delta page');
        if (pin !== undefined && head !== pin) throw new Restart('snapshot_restart');
        if (scope !== '' && header.scopeFingerprint !== scope) throw new Restart('scope_changed');
        if (pin === undefined) {
          pin = head;
          await meta.write({ head });
        }
      } else {
        if (header.scopeFingerprint !== scope) throw new Restart('scope_changed');
        if (head < position || header.kind === 'snapshot') throw new Restart('server_reset');
      }
      scope = header.scopeFingerprint;
      const cursor: StoredCursor = snapshot
        ? header.more
          ? { kind: 'snapshot', cursor: header.cursor, scopeFingerprint: scope }
          : { kind: 'delta', cursor: head, scopeFingerprint: scope }
        : { kind: 'delta', cursor: header.cursor, scopeFingerprint: scope };
      if (header.more) {
        const next = snapshot ? { after: header.cursor, pin: pin as Seq } : {};
        pending = transport.fetchPage({
          since: snapshot ? 0 : header.cursor,
          scope,
          v: PROTOCOL,
          ...next,
          // the page being applied may carry the list: the next request already holds it
          ...(header.choosable === undefined
            ? held()
            : header.choosable === ''
              ? {}
              : { choosable: header.choosable }),
        });
        pending.catch(() => undefined); // surfaced when awaited, or dropped if applying fails first
      }
      const rows: PageRows =
        header.choosable === undefined
          ? page
          : {
              ...page,
              choosable: page.people
                .filter((p) => p.choosable === true)
                .map(({ id, name }) => ({ id, name })),
            };
      const empty =
        !rows.features.length &&
        !rows.edges.length &&
        !rows.observations.length &&
        !rows.tombstones.length &&
        rows.choosable === undefined;
      // purges first: a crash before the cursor commits repeats them, and they are idempotent
      await purge(page.tombstones);
      if (!(empty && !snapshot && cursor.cursor === position)) await store.applyPage(rows, cursor);
      counts.pages++;
      position = cursor.cursor;
      if (snapshot) setStatus({ featuresLoaded: status.featuresLoaded + rows.features.length });
      if (!header.more) {
        if (snapshot) await meta.clear();
        return position;
      }
    }
  }

  /** `redaction`: drop cached history of the property (the page carries the blanked feature row). `blob`: drop bytes. */
  async function purge(tombstones: readonly SyncTombstone[]): Promise<void> {
    for (const t of tombstones) {
      if (t.kind === 'blob') await store.deleteBlob(t.id);
      else if (t.kind === 'redaction') {
        const { featureId, property } = parseRedactionKey(t.id);
        await store.dropHistory(featureId, [property]);
      }
    }
  }

  async function pullOnce(): Promise<PullResult> {
    const counts: Counts = { pages: 0 };
    let reset: SyncResetReason | undefined = store.cursor() ? undefined : 'first_sync';
    accessChanged = false;
    for (let restarts = 0; ; restarts++) {
      try {
        const cursor = await drive(counts);
        if (config && versions) await config.synced(versions);
        if (reset) await predictions.rederive(reset);
        const at = clock.now();
        await meta.writeLastSynced(at);
        setStatus({
          phase: 'idle',
          lastSyncedAt: at,
          lastSyncedSeq: cursor,
          lastError: undefined,
        });
        return {
          pages: counts.pages,
          reset,
          cursor,
          ...(accessChanged ? { accessChanged } : {}),
          ...(lastAccess === undefined ? {} : { access: lastAccess }),
        };
      } catch (error) {
        if (!(error instanceof Restart)) throw error;
        if (restarts >= MAX_RESTARTS)
          throw new SyncProtocolError(
            'malformed',
            `snapshot restarted ${MAX_RESTARTS} times (${error.reason})`,
          );
        reset = error.reason;
        await store.clearCache();
        await meta.clear();
        await meta.writeLastSynced(undefined); // the local copy is gone: nothing is "synced" any more
        setStatus({ lastSyncedAt: undefined });
      }
    }
  }

  async function run(): Promise<PullResult> {
    let merged: PullResult | undefined;
    do {
      rerun = false;
      try {
        const r = await pullOnce();
        merged = merged
          ? {
              ...r,
              pages: merged.pages + r.pages,
              reset: merged.reset ?? r.reset,
              ...(merged.accessChanged === true || r.accessChanged === true ? { accessChanged: true } : {}),
            }
          : r;
      } catch (error) {
        setStatus({ phase: 'idle', lastError: classify(error) });
        throw error;
      }
    } while (rerun);
    if (!merged) throw new SyncProtocolError('malformed', 'no pull ran');
    return merged;
  }

  return {
    async restore() {
      const at = await meta.readLastSynced();
      if (at !== undefined && status.lastSyncedAt === undefined) setStatus({ lastSyncedAt: at });
    },
    pull() {
      if (inFlight) {
        rerun = true;
        return inFlight;
      }
      const p = run().finally(() => {
        inFlight = undefined;
      });
      inFlight = p;
      return p;
    },
    status: () => status,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const PROTOCOL = SYNC_PROTOCOL_VERSION;
