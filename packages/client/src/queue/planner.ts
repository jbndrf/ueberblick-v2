/**
 * Plans queued runs against the store's facts (which already layer the predictions of earlier queued runs) and
 * folds the result into predictions. It warms the history of the runs' features first (B-004: `facts.history`
 * throws for a cold feature, never answers empty).
 */
import { PLAN_MAX_RULE_DEPTH, createPlan, type PlannedRun } from '@ueberblick/core/plan';
import { formApi } from '@ueberblick/core/form';
import type { Geo } from '@ueberblick/core/geo';
import type { FeatureId, Refusal, Run, RunId } from '@ueberblick/core/model';
import type { Prediction } from '../store';
import type { RunQueueDeps } from './contract';
import { AwaitingConfig, createFeatureConfigs } from '../config/resolver';
import { createPredictor } from './predict';

export type PlanOutcome =
  | {
      readonly kind: 'ok';
      readonly predictions: readonly Prediction[];
      /** Each run (and the rule runs it caused) as planned, stamped with the version it was planned under (A-029 L1). */
      readonly planned: readonly PlannedRun[];
      /** Per submitted run: the features its own plan created (observations with `$type`), `[]` for a run that creates none. */
      readonly created: CreatedByRun;
    }
  | { readonly kind: 'refused'; readonly runId: RunId; readonly refusal: Refusal }
  /** The device does not hold (a readable copy of) this config version yet. */
  | { readonly kind: 'config'; readonly version: number };

/** The features each submitted run created, by run id. A feature only a rule run created belongs to the rule run, not here. */
export type CreatedByRun = Readonly<Record<RunId, readonly FeatureId[]>>;

/** Reads them off the plan's own `created` lists (seeded ids, so a re-plan of the same run gives the same ones). */
export function createdByRun(submitted: readonly Run[], planned: readonly PlannedRun[]): CreatedByRun {
  const out: Record<string, readonly FeatureId[]> = {};
  for (const r of submitted) out[r.id] = [];
  for (const p of planned)
    if (p.run.causedBy === undefined && p.rule === undefined) out[p.run.id] = p.created;
  return out;
}

export interface Planner {
  plan(runs: readonly Run[]): Promise<PlanOutcome>;
}

/** The default geometry engine, loaded on demand: JSTS (~400 KB) stays out of the shell chunk (docs/12, shell-size). */
export const loadDefaultGeo = (): Promise<Geo> => import('@ueberblick/core/geo').then((m) => m.createGeo());

export function createPlanner(deps: RunQueueDeps, loadGeo: () => Promise<Geo> = loadDefaultGeo): Planner {
  const { store, config: versions, clock } = deps;
  const api = createPlan(formApi);
  interface Engine {
    readonly geo: Geo;
    readonly predict: ReturnType<typeof createPredictor>;
  }
  let ready: Promise<Engine> | undefined;
  const engine = (): Promise<Engine> => {
    if (ready === undefined) {
      const loading = (deps.geo !== undefined ? Promise.resolve(deps.geo) : loadGeo()).then(
        (geo): Engine => ({ geo, predict: createPredictor(geo) }),
      );
      // A failed load (offline, chunk not cached) must not stick: the next plan tries again.
      ready = loading;
      loading.catch(() => {
        if (ready === loading) ready = undefined;
      });
    }
    return ready;
  };

  /** The runs' features and the ones next to them (bind targets, related features an expression reads). */
  const toWarm = (runs: readonly Run[]): readonly FeatureId[] => {
    const wanted = new Set<FeatureId>();
    for (const run of runs) {
      if (run.featureId === undefined) continue;
      wanted.add(run.featureId);
      for (const e of store.facts.edgesFrom(run.featureId)) wanted.add(e.to);
      for (const e of store.facts.edgesTo(run.featureId)) wanted.add(e.from);
    }
    return [...wanted];
  };

  return {
    async plan(runs) {
      const first = runs[0];
      if (first === undefined) return { kind: 'ok', predictions: [], planned: [], created: {} };
      const { geo, predict } = await engine();
      await store.warmHistory(toWarm(runs));
      // A feature plans under its own version (pinned, else deployed); a create under the deployed one. Before the
      // first sync header there is no deployed version: the run's own then is the only one the device knows.
      const configs = createFeatureConfigs({ versions, facts: store.facts, fallback: first.configVersion });
      try {
        const result = api.planFor(runs, configs.configFor, {
          clock,
          facts: store.facts,
          geo,
          limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
        });
        if (!result.ok) return { kind: 'refused', runId: result.runId, refusal: result.refusal };
        return {
          kind: 'ok',
          predictions: predict((id) => configs.configFor(id).config, store.facts, result.runs),
          planned: result.runs,
          created: createdByRun(runs, result.runs),
        };
      } catch (e) {
        if (e instanceof AwaitingConfig) return { kind: 'config', version: e.version };
        throw e;
      }
    },
  };
}
