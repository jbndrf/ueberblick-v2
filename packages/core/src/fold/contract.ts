/**
 * core.fold contract (docs/04-data-model.md semantics, docs/02-foundations.md F4, F9, F11).
 * CONTRACT — written by the lead; changes need the lead.
 *
 * - fold is the ONLY definition of current state. Current value = highest seq per (feature, property).
 * - Reserved keys: `$type` creates a feature, `$lifecycle = <state>` sets its lifecycle (registry `LIFECYCLE_STATES`). Nothing else is special (R4).
 * - Pure and incremental: folding a log in chunks equals folding it at once; never O(all features)
 *   per observation (R14). The adapter (server SQLite, device IndexedDB) persists what fold returns.
 * - fold does not parse config or rules. `FoldSchema` is the narrow view compile() (WP-013) produces
 *   from the project file; until then tests build it by hand.
 */
import type { Bbox, Derived } from '../geo/contract';
import type { Edge, FeatureId, FeatureState, Key, RecordedObservation } from '../model';
import type { GeoPredicate } from '../registry';

/** A reference: the property's value is a FeatureId (or a list of them) → edges `relation`. */
export interface FoldReference {
  readonly property: Key;
  readonly relation: Key;
  readonly to: Key;
}

/** A derived relation `predicate(self.<selfProperty>, other.<otherProperty>)` (F9), compiled from `derive:`. */
export interface FoldDerivedRelation {
  readonly relation: Key;
  readonly to: Key;
  readonly predicate: GeoPredicate;
  readonly selfProperty: Key;
  readonly otherProperty: Key;
  /**
   * Set when `derive:` is more than the single spatial predicate (e.g. `self != other && self.datum ==
   * other.datum && intersects(...)`): the key path of the whole checked expression in
   * `CompiledConfig.expressions`. Fold uses `predicate` as the prefilter and keeps a pair only if
   * `DerivedLookup.condition` also holds. compile() only emits derive expressions whose spatial part
   * is a top-level conjunct, and forbids `now`/`today()` in them (derived edges must not change with time).
   */
  readonly condition?: string;
}

export interface FoldType {
  /** Properties of a geometry type; fold stores `Derived` for each (F11). */
  readonly geometryProperties: readonly Key[];
  /**
   * The declared primary geometry (`types.<t>.geometry`, B-009): the map geometry of the feature, and the
   * property `features.geometry`, the anchor and the area come from. Absent when the type declares none;
   * there is no fallback to another geometry property. The spatial index still covers every entry of
   * `geometryProperties`, so derived relations on a non-primary geometry keep their prefilter.
   */
  readonly primaryGeometry?: Key;
  readonly references: readonly FoldReference[];
  readonly derived: readonly FoldDerivedRelation[];
  /**
   * Non-geometry properties of this type that any derived relation's `condition` reads, on either
   * side (as `self` of its own relations, as `other` of relations of types deriving to this one).
   * A condition reads only own properties of `self` and `other` (compile rejects relation traversal:
   * `derive_traverses_relation`), so this list is complete. compile() computes the union. A change to one of them lists it in `FoldResult.derivedInputsChanged`.
   */
  readonly derivedInputs?: readonly Key[];
}

export interface FoldSchema {
  readonly configVersion: number;
  readonly types: ReadonlyMap<Key, FoldType>;
}

/** Current state plus the geometry-derived values the store indexes (anchor, bbox, area). */
export interface FoldedFeature extends FeatureState {
  /** Keyed by geometry property; absent when the property has no value. */
  readonly derived: { readonly [property: string]: Derived };
}

/** Edge writes for the adapter. `remove` is applied before `put`. */
export interface EdgeChanges {
  readonly put: readonly Edge[];
  readonly remove: readonly Edge[];
}

export interface FoldResult {
  /** Undefined only when the observations never created the feature (no `$type` seen). */
  readonly feature: FoldedFeature | undefined;
  /** Reference edges implied by the new property values. */
  readonly edges: EdgeChanges;
  /**
   * Geometry properties whose value changed; the adapter then calls `recomputeDerived`. When the served state
   * flips (either direction) it also lists every geometry property of the type that has a value, so
   * derived edges of deleted features are removed and restored ones return.
   */
  readonly geometryChanged: readonly Key[];
  /**
   * Non-geometry properties that received a new value and are in `FoldType.derivedInputs`; a derived
   * relation's `condition` may read them. The adapter calls `recomputeDerived` when either this or
   * `geometryChanged` is non-empty. Never lists a geometry property (those are in `geometryChanged`).
   */
  readonly derivedInputsChanged: readonly Key[];
}

/** What derived-edge recomputation may read; the adapter answers from its R*Tree and edge table. */
export interface DerivedLookup {
  /** Live features of `type` whose bbox (of any geometry property) intersects `bbox`. */
  near(type: Key, bbox: Bbox): Iterable<FoldedFeature>;
  /** Types that declare a derived relation to `type` (for the reverse direction). */
  typesDerivingTo(type: Key): readonly Key[];
  edgesFrom(id: FeatureId, relation: Key): readonly Edge[];
  edgesTo(id: FeatureId, relation: Key): readonly Edge[];
  /**
   * Evaluates a derived relation's full `condition` (key path) for one candidate pair with
   * `self`/`other` bound; the adapter implements it with expr.condition over its Facts. Fold stays
   * free of the rule language; an error counts as false (docs/06).
   */
  condition(path: string, self: FoldedFeature, other: FoldedFeature): boolean;
}

export interface Fold {
  /**
   * Apply observations of ONE feature, ascending by seq, on top of `prev`.
   * Observations with seq ≤ prev.updatedSeq are ignored (idempotent replay).
   */
  feature(
    prev: FoldedFeature | undefined,
    observations: readonly RecordedObservation[],
    schema: FoldSchema,
  ): FoldResult;
  /** Derived edges for a feature whose geometry changed: both as `from` and as `to` (F9). */
  recomputeDerived(feature: FoldedFeature, lookup: DerivedLookup, schema: FoldSchema): EdgeChanges;
}
