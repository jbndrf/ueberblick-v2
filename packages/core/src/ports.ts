/**
 * Ports: the only way core receives I/O (F2). Server and client implement them;
 * packages/core/src/testing provides in-memory fakes. CONTRACT — changes need the lead.
 */
import type { Edge, FeatureId, FeatureState, Instant, Json, Key, RecordedObservation, RunId } from './model';
import type { Bbox } from './geo/contract';

export interface Clock {
  now(): Instant;
}

export interface Ids {
  runId(): RunId;
  featureId(): FeatureId;
}

/** Read access to current state and capped history, as seen by the side running core. */
export interface Facts {
  feature(id: FeatureId): FeatureState | undefined;
  /** Features of `type` whose geometry bbox intersects `bbox` (WGS84, Z ignored, edge contact counts). Order unspecified; features without geometry never match. */
  near(type: Key, bbox: Bbox): Iterable<FeatureState>;
  /**
   * Every live feature of `type`, with or without geometry (a list of own work orders needs no position, R4). Order
   * unspecified. O(features of the type) in every implementation, so a caller uses it for one user action or one
   * changed feature.
   */
  ofType(type: Key): Iterable<FeatureState>;
  edgesFrom(id: FeatureId, relation?: Key): readonly Edge[];
  edgesTo(id: FeatureId, relation?: Key): readonly Edge[];
  /** Newest first; devices hold at most the last 10 per (feature, property). A `limit` of 0 or less returns []. */
  history(id: FeatureId, property: string, limit: number): readonly RecordedObservation[];
  /**
   * Erasure only (B-005): every observation written by runs of `actorId`, ascending by seq, so `redact` can find the
   * personal values a participant submitted. The server answers from the `runs(actor)` index; a device knows only
   * what it holds (its own predicted runs), so an erasure run is authoritative on the server.
   */
  observationsByActor(actorId: string): readonly RecordedObservation[];
  /**
   * How many live features `actorId` created (a deleted one does not count), at most `limit` (the quota check,
   * WP-639: it needs to know "reached", not the total, so the cost is bounded by `limit`). A device keeps no run
   * attribution (like `observationsByActor`) and counts none it did not create itself; the server is authoritative.
   */
  createdBy(actorId: string, limit: number): number;
  /**
   * Erasure only: live features of `type` whose `property` equals `value` (JSON equality), in id order. An admin
   * action, so no index is promised.
   */
  featuresWith(type: Key, property: string, value: Json): Iterable<FeatureState>;
}

export interface Blobs {
  has(sha256: string): boolean;
}

export interface Ports {
  readonly clock: Clock;
  readonly ids: Ids;
  readonly facts: Facts;
  readonly blobs: Blobs;
}
