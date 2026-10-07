/** Test helpers: an in-memory server speaking the pull protocol, a shared meta port, signals. Tests and bench only. */
import type { FeatureState, Seq } from '@ueberblick/core/model';
import type { SyncPage, SyncRequest, SyncTombstone } from '@ueberblick/core/sync';
import { SYNC_PROTOCOL_VERSION, SyncProtocolError, choosableHash } from '@ueberblick/core/sync';
import type { Instant } from '@ueberblick/core/model';
import type { Signal, SyncMeta, SyncState, SyncTransport, Timers } from './contract';
import { feature, fid } from '../store/test-env';

const featureNumber = (id: string): number => Number(id.slice(-12));

export class FakeServer implements SyncTransport {
  seq = 0;
  scope = 'scope-a';
  readonly features = new Map<string, FeatureState>();
  readonly tombstones: SyncTombstone[] = [];
  readonly requests: SyncRequest[] = [];
  pageSize = 2;
  /** The participants the receiver may choose (WP-725); shipped, like the real server, only when the device's hash differs. */
  choosable: { id: string; name: string }[] = [];
  /** The header's `access` (WP-793); undefined = an older server without the field. */
  access: string | undefined;
  version = SYNC_PROTOCOL_VERSION;
  /** Called after each page was produced; tests use it to write or crash mid-snapshot. */
  afterPage: ((n: number) => void) | undefined;
  failOn: ((n: number) => Error | undefined) | undefined;
  private pages = 0;

  /** Create or update feature `n`; `extra` lands in its properties. */
  write(n: number, extra: Record<string, unknown> = {}): FeatureState {
    const f = feature(n, ++this.seq, extra);
    this.features.set(f.id, f);
    return f;
  }

  remove(n: number): void {
    this.features.delete(fid(n));
    this.tombstones.push({ seq: ++this.seq, kind: 'feature', id: fid(n) });
  }

  fetchPage(req: SyncRequest): Promise<SyncPage> {
    this.requests.push(req);
    const n = this.pages++;
    const failure = this.failOn?.(n);
    if (failure) return Promise.reject(failure);
    if (req.v !== this.version)
      return Promise.reject(new SyncProtocolError('version_mismatch', `server speaks ${this.version}`));
    const out = this.withChoosable(req, req.since === 0 ? this.snapshot(req) : this.delta(req));
    this.afterPage?.(n);
    return Promise.resolve(out);
  }

  /**
   * As of the pin: rows changed after it are skipped (they arrive in the delta). The cursor is keyset
   * (the number of the last feature sent), so writes and removals between pages never shift the next page.
   */
  private snapshot(req: SyncRequest): SyncPage {
    const head = req.pin ?? this.seq;
    const after = req.after ?? 0;
    const all = [...this.features.values()]
      .filter((f) => f.updatedSeq <= head && featureNumber(f.id) > after)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const slice = all.slice(0, this.pageSize);
    const more = all.length > slice.length;
    const last = slice.at(-1);
    return this.page('snapshot', more && last ? featureNumber(last.id) : head, head, more, slice, []);
  }

  private delta(req: SyncRequest): SyncPage {
    const changed = [...this.features.values()].filter((f) => f.updatedSeq > req.since);
    const tombs = this.tombstones.filter((t) => t.seq > req.since);
    const rows = changed.sort((a, b) => a.updatedSeq - b.updatedSeq).slice(0, this.pageSize);
    const more = changed.length > rows.length;
    const last = rows.at(-1)?.updatedSeq ?? this.seq;
    return this.page('delta', more ? last : this.seq, this.seq, more, rows, tombs);
  }

  private withChoosable(req: SyncRequest, page: SyncPage): SyncPage {
    const hash = choosableHash(this.choosable);
    if (hash === (req.choosable ?? '')) return page;
    return {
      ...page,
      header: { ...page.header, choosable: hash },
      people: this.choosable.map((p) => ({ ...p, choosable: true })),
    };
  }

  private page(
    kind: SyncPage['header']['kind'],
    cursor: Seq,
    head: Seq,
    more: boolean,
    features: FeatureState[],
    tombstones: SyncTombstone[],
  ): SyncPage {
    return {
      header: {
        kind,
        cursor,
        head,
        more,
        scopeFingerprint: this.scope,
        ...(this.access === undefined ? {} : { access: this.access }),
        versions: { deployed: 1, live: [1] },
      },
      features: features.map((f) => ({ ...f, version: 1 })),
      edges: [],
      observations: [],
      tombstones,
      runs: [],
      people: [],
    };
  }
}

export function memoryMeta(): SyncMeta & { state: SyncState | undefined } {
  const m = {
    state: undefined as SyncState | undefined,
    read: () => Promise.resolve(m.state),
    write: (s: SyncState) => {
      m.state = s;
      return Promise.resolve();
    },
    clear: () => {
      m.state = undefined;
      return Promise.resolve();
    },
    lastSynced: undefined as Instant | undefined,
    readLastSynced: () => Promise.resolve(m.lastSynced),
    writeLastSynced: (at: Instant | undefined) => {
      m.lastSynced = at;
      return Promise.resolve();
    },
  };
  return m;
}

export function manualSignal(): Signal & { ring(): void; listeners: number } {
  const set = new Set<() => void>();
  return {
    subscribe: (fn) => {
      set.add(fn);
      return () => set.delete(fn);
    },
    ring: () => set.forEach((fn) => fn()),
    get listeners() {
      return set.size;
    },
  };
}

/** Timers driven by hand: `advance(ms)` fires what is due. */
export function manualTimers(): Timers & { advance(ms: number): void; pending(): number } {
  let now = 0;
  let next = 1;
  const tasks = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn, ms) => {
      const id = next++;
      tasks.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => {
      tasks.delete(h as number);
    },
    advance: (ms) => {
      now += ms;
      for (const [id, t] of [...tasks]) {
        if (t.at <= now) {
          tasks.delete(id);
          t.fn();
        }
      }
    },
    pending: () => tasks.size,
  };
}
