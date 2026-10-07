/**
 * Prediction: what the store would show if the planned runs were accepted. `core.plan` returns observations;
 * `core.fold` (the only definition of current state, F4) turns them into feature states, layered over `facts`
 * (which already include the predictions of earlier queued runs). One `Prediction` per SUBMITTED run: the
 * rule runs it caused are folded into it.
 *
 * Limits (reported in the WP-511 log): only reference edges are predicted, and only additions. A removed
 * reference edge and derived edges (geometry relations) are not layered; the server state replaces the
 * prediction on the next pull. A core `applyPlanned` would close this (H1, derived edges).
 */
import { auditOf, createFold, edgeKey } from '@ueberblick/core/fold';
import type { FoldedFeature, FoldSchema } from '@ueberblick/core/fold';
import type { Geo } from '@ueberblick/core/geo';
import type { Edge, FeatureId, FeatureState, RecordedObservation, RunId } from '@ueberblick/core/model';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import type { Facts } from '@ueberblick/core/ports';
import type { PlannedRun } from '@ueberblick/core/plan';
import type { PlannedChange, Prediction } from '../store';

const schemas = new WeakMap<CompiledConfig, FoldSchema>();

/** The narrow fold view of a config (`foldSchema` in core's compiler is exactly this pair; the compiler stays off the device). */
function schemaOf(config: CompiledConfig): FoldSchema {
  let s = schemas.get(config);
  if (s === undefined) {
    s = { configVersion: 0, types: config.foldTypes };
    schemas.set(config, s);
  }
  return s;
}

const plain = (f: FoldedFeature, version: number | undefined): FeatureState => ({
  id: f.id,
  type: f.type,
  properties: f.properties,
  lifecycle: f.lifecycle,
  ...auditOf(f),
  updatedSeq: f.updatedSeq,
  ...(version === undefined ? {} : { version }),
});

export function createPredictor(geo: Geo) {
  const fold = createFold(geo);
  return function predict(
    configOf: (id: FeatureId) => CompiledConfig,
    facts: Facts,
    planned: readonly PlannedRun[],
  ): readonly Prediction[] {
    const folded = new Map<FeatureId, FoldedFeature>();
    const out: Prediction[] = [];
    let current:
      | { runId: RunId; touched: Set<FeatureId>; edges: Map<string, Edge>; observations: PlannedChange[] }
      | undefined;

    const flush = () => {
      if (current === undefined) return;
      const features = [...current.touched].flatMap((id) => {
        const f = folded.get(id);
        return f === undefined ? [] : [plain(f, facts.feature(f.id)?.version)];
      });
      out.push({
        runId: current.runId,
        observations: current.observations,
        features,
        edges: [...current.edges.values()],
      });
    };

    for (const p of planned) {
      if (p.run.causedBy === undefined) {
        flush();
        current = { runId: p.run.id, touched: new Set(), edges: new Map(), observations: [] };
      }
      if (current === undefined) continue;
      for (const o of p.observations) {
        current.observations.push({ featureId: o.featureId, property: o.property, result: o.result });
        const stored = facts.feature(o.featureId);
        const prev =
          folded.get(o.featureId) ?? (stored === undefined ? undefined : { ...stored, derived: {} });
        const rec: RecordedObservation = { ...o, runId: p.run.id, seq: (prev?.updatedSeq ?? 0) + 1 };
        const r = fold.feature(prev, [rec], schemaOf(configOf(o.featureId)));
        if (r.feature === undefined) continue;
        folded.set(o.featureId, r.feature);
        current.touched.add(o.featureId);
        for (const e of r.edges.remove) current.edges.delete(edgeKey(e));
        for (const e of r.edges.put) current.edges.set(edgeKey(e), e);
      }
    }
    flush();
    return out;
  };
}
