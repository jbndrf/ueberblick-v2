/**
 * Pull protocol contract (docs/07-sync-and-offline.md). Shared by the server (WP-106) and the device.
 *
 * - Pure types and helpers. No HTTP, no gzip (adapters compress), no IndexedDB, no SSE doorbell.
 * - Telemetry is NOT part of this protocol (H5). Delta pages carry many features from one batch (H2).
 *   The same page format serves ephemeral-view clients (H4).
 * - Geometry is an ordinary property value inside `properties`; positions keep their Z (H1).
 */
import type { Edge, FeatureState, Instant, RecordedObservation, RunId, Seq } from '../model';
import type { SyncPageKind, SyncTombstoneKind } from './registry';

/** Major number: bump only when a column, field or meaning is removed or changed. Additive columns need no bump. */
export const SYNC_PROTOCOL_VERSION = 3;

/**
 * The participant of the session, named on both sides (WP-768). The device sends it on every run and sync request as
 * the participant it works as; the server answers 409 `session_changed` without touching anything when the
 * session's participant is another one, and names the session's participant in this header on every reply.
 * A client that sends no such header (an API token, QGIS) is not checked.
 */
export const SESSION_PARTICIPANT_HEADER = 'x-ub-participant';

/** The `code` of the 409 body that answers a request made as another participant than the session's. */
export const SESSION_CHANGED_CODE = 'session_changed';

/** A snapshot page keeps at most this many observations per (feature, property) (docs/04). */
export const SYNC_OBSERVATION_HISTORY = 10;

/** `GET /sync?since=&scope=&v=`. `since = 0` asks for a snapshot. */
export interface SyncRequest {
  readonly since: Seq;
  /** The scope fingerprint the device last synced under; empty on first sync. */
  readonly scope: string;
  readonly v: number;
  /** Snapshot only: continue after this paging cursor (the `cursor` of the last page received). */
  readonly after?: Seq;
  /** Snapshot only: the head the snapshot began at; the server keeps answering as of this head. */
  readonly pin?: Seq;
  /** Most feature rows the device wants per page; the server sends at most this many. Absent = the server default. */
  readonly limit?: number;
  /**
   * The `choosableHash` of the choosable participants the device holds (WP-725); absent = none. The server ships
   * the list only when it differs from its current one.
   */
  readonly choosable?: string;
}

export interface SyncPageHeader {
  readonly kind: SyncPageKind;
  /** Resume point: the next `since` (delta) or paging cursor (snapshot). */
  readonly cursor: Seq;
  /** The server head seq. For a snapshot, the pinned head: the device continues with a delta from it. */
  readonly head: Seq;
  readonly more: boolean;
  /** Fingerprint of the participant's scope now. A change makes the device re-snapshot. */
  readonly scopeFingerprint: string;
  /** The config versions the server serves now (A-029 §4): the deployed one and every version a feature is pinned to. */
  readonly versions: SyncVersions;
  /**
   * Present only when this page carries the choosable list (WP-725): the `choosableHash` of that list. The `people`
   * rows with `choosable` on this page are then the whole list and REPLACE the device's set (empty = nobody).
   */
  readonly choosable?: string;
  /**
   * A hash of what decides task availability for this actor now (WP-793): their sorted role keys. Optional and
   * additive (an older server omits it). Separate from `scopeFingerprint`: a change tells the device to re-read its
   * roles, it never re-snapshots.
   */
  readonly access?: string;
}

/** The live set: `deployed` plus the distinct pinned versions, ascending, each once. `deployed` is always in `live`. */
export interface SyncVersions {
  readonly deployed: number;
  readonly live: readonly number[];
}

/**
 * A feature row as sent: the state plus the config version it follows, `coalesce(pinned_version, deployed)` (A-029).
 * Its properties are clipped by the permissions of that version.
 */
export interface SyncFeature extends FeatureState {
  readonly version: number;
}

/** An observation as sent: `phenomenonTime` is null, never absent; `resultTime` is an additive column (null = none). */
export interface SyncObservation extends Omit<RecordedObservation, 'phenomenonTime' | 'resultTime'> {
  readonly phenomenonTime: Instant | null;
  readonly resultTime: Instant | null;
}

export interface SyncEdge extends Edge {
  readonly updatedSeq: Seq;
}

export interface SyncTombstone {
  readonly seq: Seq;
  readonly kind: SyncTombstoneKind;
  /** Opaque per kind: a feature id, or the edge key the server assigns. */
  readonly id: string;
}

/**
 * One run that wrote observations on the page: what v3 showed per change. A plain row (H3, H5, H6 read it later); grouping
 * observations by run is the reader's job, not part of this type.
 */
export interface SyncRun {
  readonly id: RunId;
  readonly task: string;
  /** The participant id, or null when the receiving role may not see names and the run is not its own. */
  readonly actor: string | null;
  /** When the device recorded the run (epoch ms); null when it sent none. */
  readonly clientTime: number | null;
  /** When the server received it (epoch ms). */
  readonly receivedAt: number;
  readonly seq: Seq;
  readonly causedBy: RunId | null;
}

/**
 * The display name of an actor id that appears in `runs`, clipped exactly like `SyncRun.actor`; or, with
 * `choosable`, a participant the receiver may choose for a participant property (WP-725: `select.all`). The name
 * is empty when the participant has none. Never an email (A-028).
 */
export interface SyncPerson {
  readonly id: string;
  readonly name: string;
  readonly choosable?: boolean;
}

/** A page with rows as objects: what core, the server adapter and the device store work with. */
export interface SyncPage {
  readonly header: SyncPageHeader;
  readonly features: readonly SyncFeature[];
  readonly edges: readonly SyncEdge[];
  readonly observations: readonly SyncObservation[];
  readonly tombstones: readonly SyncTombstone[];
  /** The runs of the observations on this page, one row each; empty when the page has none. */
  readonly runs: readonly SyncRun[];
  /** The names of the actors in `runs`; clipped exactly like `SyncRun.actor`. */
  readonly people: readonly SyncPerson[];
}

/** One table on the wire: the column list once, then row tuples in that order. */
export interface TupleTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

/** A page on the wire (JSON-serialisable). */
export interface EncodedPage {
  readonly v: number;
  readonly header: SyncPageHeader;
  readonly features: TupleTable;
  readonly edges: TupleTable;
  readonly observations: TupleTable;
  readonly tombstones: TupleTable;
  readonly runs: TupleTable;
  readonly people: TupleTable;
}
