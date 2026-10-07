// Fixture of the sync-snapshot-60k scenario (WP-560): the snapshot pages a server would send, generated on
// demand and seeded by page number. Shaped like the client-store bench: a Point geometry, a species, a height,
// three observations and one edge per feature. The transport is in memory; IndexedDB and the store are real.
import type { FeatureId, Key, RunId, Seq } from '@ueberblick/core/model';
import { SYNC_PROTOCOL_VERSION } from '@ueberblick/core/sync';
import type { SyncEdge, SyncFeature, SyncObservation, SyncPage, SyncRequest } from '@ueberblick/core/sync';
import type { SyncTransport } from '../../../packages/client/src/sync/contract';

export const PAGE_FEATURES = 1000;
export const PAGES = 60;
export const SCOPE = 'bench-scope';
/** The pinned head of the snapshot; above every `updatedSeq` of a feature. */
const HEAD = 10_000_000 as Seq;
const OBS_PER_FEATURE = 3;

const uuid = (kind: number, n: number): string =>
  `018f0000-0000-7000-${kind}000-${String(n).padStart(12, '0')}`;
const fid = (n: number): FeatureId => uuid(8, n) as FeatureId;

/** Snapshot page `p` of `pages`; the keyset cursor of a page is the number of its last feature. */
export function snapshotPage(p: number, pages: number): SyncPage {
  const features: SyncFeature[] = [];
  const observations: SyncObservation[] = [];
  const edges: SyncEdge[] = [];
  const first = p * PAGE_FEATURES;
  for (let i = 0; i < PAGE_FEATURES; i++) {
    const n = first + i;
    const id = fid(n);
    features.push({
      id,
      type: 'tree' as Key,
      properties: {
        geometry: { type: 'Point', coordinates: [13 + n / 1e5, 52, 30] },
        species: `s-${n % 40}`,
        h: n % 300,
      },
      lifecycle: 'active',
      version: 1,
      updatedSeq: n + 1,
    });
    for (let k = 0; k < OBS_PER_FEATURE; k++)
      observations.push({
        featureId: id,
        property: 'h',
        result: k,
        phenomenonTime: null,
        resultTime: null,
        seq: n * OBS_PER_FEATURE + k + 1,
        runId: uuid(9, n * OBS_PER_FEATURE + k) as RunId,
      });
    edges.push({
      from: id,
      relation: 'parent' as Key,
      to: fid(first + ((i + 1) % PAGE_FEATURES)),
      derived: false,
      updatedSeq: n + 1,
    });
  }
  const more = p + 1 < pages;
  return {
    header: {
      kind: 'snapshot',
      cursor: (more ? (p + 1) * PAGE_FEATURES : HEAD) as Seq,
      head: HEAD,
      more,
      scopeFingerprint: SCOPE,
      versions: { deployed: 1, live: [1] },
    },
    features,
    edges,
    observations,
    tombstones: [],
    runs: [],
    people: [],
  };
}

export interface SnapshotServer extends SyncTransport {
  pagesServed(): number;
}

/** The server side of a snapshot: `after` is the last feature number sent. `beforePage(n)` runs before page `n` is built. */
export function snapshotServer(
  pages: number,
  beforePage: (n: number) => void = () => undefined,
): SnapshotServer {
  let served = 0;
  return {
    fetchPage(req: SyncRequest) {
      if (req.v !== SYNC_PROTOCOL_VERSION) return Promise.reject(new Error(`protocol ${req.v}`));
      const p = (req.after ?? 0) / PAGE_FEATURES;
      beforePage(p);
      served++;
      return Promise.resolve(snapshotPage(p, pages));
    },
    pagesServed: () => served,
  };
}
