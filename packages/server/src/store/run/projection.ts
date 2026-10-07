/**
 * The fold step of the run transaction: observations -> `features`, `edges`, `feature_bbox` through core.fold and
 * `createFoldWriter`, then derived edges for every feature whose geometry (or a derive input) changed. Must run inside the
 * caller's transaction. Only the features the observations name are read: nothing here scans all features (R14).
 */
import {
  createFold,
  type CompiledConfig,
  type Derived,
  type Edge,
  type Facts,
  type FeatureId,
  type FeatureState,
  type FoldedFeature,
  type FoldSchema,
  type Geometry,
  type Json,
  type RecordedObservation,
  RESERVED_VERSION,
} from '@ueberblick/core';
import { foldSchema } from '@ueberblick/core/compile';
import type { Db } from '../../db/driver';
import { derivedCondition } from '../../derive/condition';
import { createDerivedLookup, createFoldWriter } from '../facts';
import type { StoreDeps } from './contract';

/** Which config a feature is folded under (A-029): the deployed version unless the feature is pinned. */
export interface ProjectAt {
  readonly deployed: number;
  /** The compiled config of a version. */
  config(version: number): CompiledConfig;
}

export interface Projector {
  /**
   * Folds `observations` (ascending seq, all newer than what is stored) and persists the result. Each feature is
   * folded under its own version: its pin (a `$version` observation of this batch, else the stored one), else
   * `at.deployed`. `head` is the highest seq of the batch (`updated_seq` of the edges it puts). Returns the features as folded.
   */
  project(
    at: ProjectAt,
    observations: readonly RecordedObservation[],
    head: number,
  ): readonly FoldedFeature[];
}

const isGeometry = (v: Json | undefined): v is Json & Geometry =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as { type?: unknown }).type === 'string';

export function createProjector(db: Db, deps: Pick<StoreDeps, 'geo' | 'clock'>, facts: Facts): Projector {
  const fold = createFold(deps.geo);
  const writer = createFoldWriter(db);

  /** A stored feature has no derived values until its geometry is folded; the store indexes them, so restore them. */
  const withDerived = (state: FeatureState, geometryProperties: readonly string[]): FoldedFeature => {
    const derived: { [p: string]: Derived } = {};
    for (const p of geometryProperties) {
      const g = state.properties[p];
      if (isGeometry(g)) derived[p] = deps.geo.derive(g);
    }
    return { ...state, derived };
  };

  /** The version `list` leaves `prev` folded under: a `$version` in the batch wins (null unpins), else the stored pin. */
  const versionOf = (
    prev: FeatureState | undefined,
    list: readonly RecordedObservation[],
    deployed: number,
  ): number => {
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i] as RecordedObservation;
      if (o.property === RESERVED_VERSION) return typeof o.result === 'number' ? o.result : deployed;
    }
    return prev?.pinnedVersion ?? deployed;
  };

  return {
    project(at, observations, head): readonly FoldedFeature[] {
      const byFeature = new Map<FeatureId, RecordedObservation[]>();
      for (const o of observations) {
        const list = byFeature.get(o.featureId);
        if (list === undefined) byFeature.set(o.featureId, [o]);
        else list.push(o);
      }

      /** One group per version: a plain batch has exactly one (the deployed one). */
      interface Group {
        readonly config: CompiledConfig;
        readonly schema: FoldSchema;
        readonly features: FoldedFeature[];
        readonly put: Edge[];
        readonly remove: Edge[];
        readonly moved: FoldedFeature[];
      }
      const groups = new Map<number, Group>();
      const group = (version: number): Group => {
        let g = groups.get(version);
        if (g === undefined) {
          const config = at.config(version);
          g = { config, schema: foldSchema(config, version), features: [], put: [], remove: [], moved: [] };
          groups.set(version, g);
        }
        return g;
      };

      const features: FoldedFeature[] = [];
      for (const [id, list] of byFeature) {
        const state = facts.feature(id);
        const g = group(versionOf(state, list, at.deployed));
        const prev = state && withDerived(state, g.schema.types.get(state.type)?.geometryProperties ?? []);
        const r = fold.feature(prev, list, g.schema);
        if (r.feature === undefined) continue;
        features.push(r.feature);
        g.features.push(r.feature);
        g.put.push(...r.edges.put);
        g.remove.push(...r.edges.remove);
        if (r.geometryChanged.length > 0 || r.derivedInputsChanged.length > 0) g.moved.push(r.feature);
      }
      for (const [version, g] of groups) {
        writer.apply({
          configVersion: version,
          schema: g.schema,
          features: g.features,
          edges: { put: g.put, remove: g.remove },
          seq: head,
        });
        if (g.moved.length === 0) continue;
        const lookup = createDerivedLookup(db, g.schema, deps.geo, derivedCondition(g.config, facts, deps));
        for (const f of g.moved) {
          const changes = fold.recomputeDerived(f, lookup, g.schema);
          if (changes.put.length > 0 || changes.remove.length > 0)
            writer.apply({
              configVersion: version,
              schema: g.schema,
              features: [],
              edges: changes,
              seq: head,
            });
        }
      }
      return features;
    },
  };
}
