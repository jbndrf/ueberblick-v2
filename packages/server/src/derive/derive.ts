/**
 * Derived-edge recomputation outside a run (WP-108): the batch entry that `core.fold.recomputeDerived` lacks.
 * The run transaction already recomputes edges for the features a run moved (`store/run/projection.ts`); this is
 * for everything else that changes geometry without a run of its own: a config version that adds a `derive:`
 * relation, or a repair. It is incremental (H2): per changed feature, R*Tree candidates near it only.
 *
 * Per version (A-029, WP-318): the touched features are grouped by effective version (`coalesce(pinned_version,
 * deployed)`) and each group is recomputed with its own version's schema and condition. With no pin there is one
 * group, the deployed one.
 */
import {
  createFold,
  type Clock,
  type Derived,
  type DerivedLookup,
  type FeatureId,
  type FeatureState,
  type FoldedFeature,
  type FoldSchema,
  type Geo,
  type Geometry,
  type Json,
} from '@ueberblick/core';
import { foldSchema } from '@ueberblick/core/compile';
import type { Db } from '../db/driver';
import { ConfigVersionGone, inverseRelations, NoDeployedVersion } from '../store';
import type { VersionResolver } from '../store/run/config-for';
import { createDerivedLookup, createFoldWriter, createFacts } from '../store/facts';
import { derivedCondition } from './condition';

/** What derive needs of one config version: its fold schema and the caller's `expr.condition` over its facts. */
export interface DeriveVersion {
  readonly schema: FoldSchema;
  /** For relations whose `derive:` is more than a predicate. */
  readonly condition: DerivedLookup['condition'];
}

export interface DeriveDeps {
  readonly geo: Geo;
  /** The deployed version: what a floating feature (no pin) is recomputed under. Throws before the first deploy. */
  deployed(): number;
  /** One version's schema and condition. The caller builds it once per version; derive keeps the lookup per version. */
  at(version: number): DeriveVersion;
}

export interface DeriveResult {
  /** Edges added. */
  readonly put: number;
  /** Edges removed (each leaves an `edge` tombstone). */
  readonly remove: number;
}

export interface Derive {
  /**
   * Recomputes the derived edges of every listed feature, both as `self` and as `other`, in one transaction.
   * Ids that are not stored are skipped. `seq` stamps the edges it puts (`updated_seq`); by default the seq
   * after the current head, so a device that synced before the change receives it.
   */
  recompute(changed: readonly FeatureId[], seq?: number): DeriveResult;
}

const isGeometry = (v: Json | undefined): v is Json & Geometry =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as { type?: unknown }).type === 'string';

interface VersionGroup {
  readonly schema: FoldSchema;
  readonly lookup: DerivedLookup;
}

export function createDerive(db: Db, deps: DeriveDeps): Derive {
  const fold = createFold(deps.geo);
  const facts = createFacts(db, new Map());
  const writer = createFoldWriter(db);
  const lookups = new Map<number, VersionGroup>();
  const groupOf = (version: number): VersionGroup => {
    let g = lookups.get(version);
    if (g === undefined) {
      const v = deps.at(version);
      g = { schema: v.schema, lookup: createDerivedLookup(db, v.schema, deps.geo, v.condition) };
      lookups.set(version, g);
    }
    return g;
  };
  const head = db.prepare<{ seq: number }>(
    'SELECT max(coalesce((SELECT max(seq) FROM observations), 0), coalesce((SELECT max(seq) FROM tombstones), 0)) AS seq',
  );

  const folded = (state: FeatureState, schema: FoldSchema): FoldedFeature => {
    const derived: { [p: string]: Derived } = {};
    for (const p of schema.types.get(state.type)?.geometryProperties ?? []) {
      const g = state.properties[p];
      if (isGeometry(g)) derived[p] = deps.geo.derive(g);
    }
    return { ...state, derived };
  };

  return {
    recompute(changed, seq) {
      return db.transaction(() => {
        const stamp = seq ?? (head.get()?.seq ?? 0) + 1;
        // O(touched): one read per feature, then one group per live version, in the order the ids came.
        const groups = new Map<number, FeatureState[]>();
        let deployed: number | undefined;
        for (const id of changed) {
          const state = facts.feature(id);
          if (state === undefined) continue;
          const version = state.pinnedVersion ?? (deployed ??= deps.deployed());
          const list = groups.get(version);
          if (list === undefined) groups.set(version, [state]);
          else list.push(state);
        }
        let put = 0;
        let remove = 0;
        for (const [version, states] of groups) {
          const { schema, lookup } = groupOf(version);
          // One feature at a time: the edges written for one are what the next one's diff reads.
          for (const state of states) {
            const edges = fold.recomputeDerived(folded(state, schema), lookup, schema);
            if (edges.put.length === 0 && edges.remove.length === 0) continue;
            writer.apply({
              configVersion: schema.configVersion,
              schema,
              features: [],
              edges,
              seq: stamp,
            });
            put += edges.put.length;
            remove += edges.remove.length;
          }
        }
        return { put, remove };
      });
    },
  };
}

/** `createDerive` over the project's shared version resolver: each version's schema and `condition` are built once. */
export function createDeriveFor(
  db: Db,
  deps: { readonly versions: VersionResolver; readonly geo: Geo; readonly clock: Clock },
): Derive {
  const built = new Map<number, DeriveVersion>();
  return createDerive(db, {
    geo: deps.geo,
    deployed() {
      const d = deps.versions.deployed();
      if (d === undefined) throw new NoDeployedVersion();
      return d.version;
    },
    at(version) {
      let v = built.get(version);
      if (v === undefined) {
        const config = deps.versions.configFor(version);
        if (config === undefined) throw new ConfigVersionGone(version);
        v = {
          schema: foldSchema(config, version),
          condition: derivedCondition(config, createFacts(db, inverseRelations(config)), deps),
        };
        built.set(version, v);
      }
      return v;
    },
  });
}
