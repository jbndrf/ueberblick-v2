/**
 * Server store, read side (WP-104.1). CONTRACT: changes need the lead.
 *
 * - `createFacts(db, inverse)` implements core's `Facts` and `FeatureAccess` over the project database
 *   (docs/04). Reads use prepared statements and the WP-100 indexes only; nothing scans all features.
 * - `related(id, relation)` answers references, derived edges (both stored in `edges`) and inverse
 *   relations. `inverse` is `inverseRelations(config)`; an inverse reads the edges of its source type backwards.
 * - `createFoldWriter(db)` prepares its statements once per connection; `apply(batch)` persists `core.fold` output in ONE transaction: `features`, `edges`,
 *   `feature_bbox`, and an `edge` tombstone (`seq`, `kind`, `id = edgeKey`) for every edge it removes.
 *   Replaying a batch changes nothing (a feature is skipped when the row is not older).
 * - `features.geometry` holds the type's declared primary geometry (`FoldType.primaryGeometry`, empty when it has no value) as stored (Z kept, H1); anchor and
 *   area come from its `Derived`. `feature_bbox` holds the union bbox of all geometry properties of a live
 *   feature (rid = `features.rowid`) and no row for a deleted one.
 * - `bboxQuery` and `createDerivedLookup` answer viewport and derived-edge candidate queries from the R*Tree.
 */
import type {
  Bbox,
  DerivedLookup,
  EdgeChanges,
  Facts,
  FeatureId,
  FoldedFeature,
  FoldSchema,
  Geo,
  Seq,
} from '@ueberblick/core';
import type { FeatureAccess } from '@ueberblick/core/expr';
import type { Db } from '../db/driver';

/** Facts plus the evaluation port, over one project database. */
export interface ServerFacts extends Facts, FeatureAccess {}

/** One inverse relation: its edges are stored under `key` on features of type `from`, and read backwards. */
export interface InverseRelation {
  readonly key: string;
  readonly from: string;
}

/**
 * `<type>.<relation>` -> where its edges are stored. Keyed by the reading type and the source type
 * (`InverseRelation.from`), so two types that store edges under the same key never mix in an inverse read.
 * `inverseRelations(config)` (`store/run/inverse.ts`) is the producer.
 */
export type InverseRelations = ReadonlyMap<string, InverseRelation>;

/** One batch of fold output; commits together or not at all (H2). */
export interface FoldBatch {
  readonly configVersion: number;
  readonly schema: FoldSchema;
  /** Latest fold state per feature; a row that is not older than the stored one is skipped. */
  readonly features: readonly FoldedFeature[];
  /** Reference and derived edge changes; `remove` before `put`. */
  readonly edges: EdgeChanges;
  /** `updated_seq` written on every edge put (the highest seq of the batch). */
  readonly seq: Seq;
}

/** Writes fold output; create one per connection and reuse it (every accepted run and derive pass calls it). */
export interface FoldWriter {
  apply(batch: FoldBatch): void;
}

export interface BboxHit {
  readonly id: FeatureId;
  readonly type: string;
}

export interface StoreApi {
  createFacts(db: Db, inverse: InverseRelations): ServerFacts;
  createFoldWriter(db: Db): FoldWriter;
  /** Live features whose bbox intersects `bbox`, optionally of one type. Ordered by id. */
  bboxQuery(db: Db, bbox: Bbox, type?: string): readonly BboxHit[];
  /** The adapter side of `Fold.recomputeDerived`: candidates from the R*Tree, edges from the edge table. */
  createDerivedLookup(
    db: Db,
    schema: FoldSchema,
    geo: Geo,
    condition: DerivedLookup['condition'],
  ): DerivedLookup;
}
