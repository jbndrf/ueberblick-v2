/**
 * "Could this device still hold this feature?" for a feature the participant does not see now.
 *
 * A device may hold a feature in any state it was ever read in: a delta is paged by feature, so a page's `since`
 * says little about what the device has of a feature that is still waiting for its page. So the answer is: was the
 * feature visible to this actor in ANY committed state of its history (state = the fold after each run's
 * observations)? Only then does the delta carry a `feature` tombstone. A feature that was never visible to the actor
 * never appears, not even as a tombstone. Cost: the history of one changed, currently invisible feature, paid by the
 * puller. No per-participant work is done when a run commits (docs/12).
 * Limit (docs/decisions/later/A-015): relation-based `visible_when` reads the relations, and the features they lead
 * to, as they are now; the replay can then say "was visible" once for a feature the device never held. The tombstone
 * carries the id only, so the cost is one no-op delete on the device.
 */
import {
  actorValue,
  featureAccess,
  type FeatureId,
  type FeatureState,
  type Json,
  type Key,
  type FeatureAudit,
  type LifecycleState,
  foldAudit,
  isServed,
  readSystemField,
} from '@ueberblick/core';
import type { EvalContext, FeatureAccess } from '@ueberblick/core/expr';
import type { Db } from '../db/driver';
import { createFacts, inverseRelations, type ServerFacts } from '../store';
import type { SyncServiceDeps } from './contract';
import type { Scope } from './visibility';

interface Row {
  property: string;
  result: string | null;
  run_id: string;
  seq: number;
  phenomenon_time: string | null;
  result_time: string | null;
}

export type EverVisible = (scope: Scope, feature: { id: string; type: string }, now: string) => boolean;

export function createEverVisible(db: Db, deps: Pick<SyncServiceDeps, 'geo'>): EverVisible {
  const history = db.prepare<Row>(
    'SELECT property, result, run_id, seq, phenomenon_time, result_time FROM observations WHERE feature_id = ? ORDER BY seq',
  );
  const facts = new Map<number, ServerFacts>();
  const factsOf = (scope: Scope): ServerFacts => {
    let f = facts.get(scope.version);
    if (!f) {
      f = createFacts(db, inverseRelations(scope.config));
      facts.set(scope.version, f);
    }
    return f;
  };

  return (scope, feature, now) => {
    const type = scope.perms.forType(feature.type as Key);
    if (type === undefined) return false;
    const subjects = scope.perms.subjects(scope.actor);
    const base = factsOf(scope);
    const props: { [k: string]: Json } = {};
    // The planner's access (R1), except that the feature under test reads its own historical state: its properties
    // and its reference properties (its outgoing relations), not the stored row and the current edges.
    const current = featureAccess(base, scope.config);
    const references = new Set<string>(
      scope.config.foldTypes.get(feature.type as Key)?.references.map((r) => r.property),
    );
    const primary = scope.config.file.types?.[feature.type]?.geometry;
    // The replayed state of the feature under test: lifecycle and audit fields change over its history, like properties.
    let existed = false;
    let lifecycle: LifecycleState = 'active';
    let audit: FeatureAudit = {};
    let last = 0;
    const replayed = (): FeatureState => ({
      id: feature.id as FeatureId,
      type: feature.type as Key,
      properties: props,
      lifecycle,
      ...audit,
      updatedSeq: last,
    });
    const access: FeatureAccess = {
      ...current,
      property(id, key) {
        if (id !== feature.id) return current.property(id, key);
        if (key.startsWith('$')) return readSystemField(replayed(), key);
        if (references.has(key)) return undefined; // a reference reads as a relation
        return props[key] ?? (key === 'geometry' && primary !== undefined ? props[primary] : undefined);
      },
      related(id, relation) {
        if (id !== feature.id || !references.has(relation)) return current.related(id, relation);
        const v = props[relation];
        const ids = Array.isArray(v) ? v : [v];
        return ids.filter((x): x is FeatureId & string => typeof x === 'string') as FeatureId[];
      },
    };
    const ctx: EvalContext = {
      vars: new Map([['actor', actorValue(scope.actor)]]),
      features: access,
      now,
      relations: scope.config.relations,
      geo: deps.geo,
    };
    const seesNow = (seq: number): boolean => {
      if (!existed || !isServed(lifecycle)) return false;
      return type.canSee(subjects, { ...replayed(), updatedSeq: seq }, ctx).ok;
    };

    let run: string | undefined;
    for (const o of history.all(feature.id)) {
      if (run !== undefined && o.run_id !== run && seesNow(last)) return true;
      run = o.run_id;
      last = o.seq;
      const value = (o.result === null ? null : JSON.parse(o.result)) as Json;
      audit = foldAudit(audit, {
        property: o.property,
        result: value,
        ...(o.phenomenon_time === null ? {} : { phenomenonTime: o.phenomenon_time }),
        ...(o.result_time === null ? {} : { resultTime: o.result_time }),
      });
      if (o.property === '$type') existed = true;
      else if (o.property === '$lifecycle') lifecycle = value as LifecycleState;
      else if (!o.property.startsWith('$')) props[o.property] = value;
    }
    return run !== undefined && seesNow(last);
  };
}
