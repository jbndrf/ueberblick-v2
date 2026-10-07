/**
 * The seam the golden scenario runner drives: what a server must offer so the same scenarios run against the
 * simulated server and against a real adapter (the SQLite run store, WP-104). `simScenarioServer` adapts `SimServer`.
 */
import type { Edge, FeatureId, FeatureState, RecordedObservation, Run, RunId, Seq } from '../model';
import type { Geo } from '../geo/contract';
import type { PlanLimits } from '../plan/contract';
import type { Perms } from '../perms/contract';
import type { AutoId } from '../schema/compile/autos';
import type { CompiledConfig } from '../schema/compile/contract';
import type { SubmitResult } from './contract';
import type { FakeClock } from './ids';
import type { MemoryStore } from '../memory';
import { SimServer } from './server';

export interface ScenarioServer {
  readonly config: CompiledConfig;
  /** Highest observation seq. */
  readonly head: Seq;
  /** One request: a run, or a batch (`atomic`: one refusal refuses all, H2). A repeated run id answers from the ledger. */
  submit(batch: readonly Run[], atomic: boolean, asBatch: boolean): SubmitResult;
  /** Seeds are facts, not runs: `fill` writes them into a scratch `MemoryStore`, the server ingests its log. */
  seed(fill: (store: MemoryStore) => void): void;
  observationsSince(seq: Seq): readonly RecordedObservation[];
  /** Everything a refused step must leave unchanged (observations, features, edges, indexes), as one string. */
  snapshot(): string;
  feature(id: FeatureId): FeatureState | undefined;
  edgesFrom(id: FeatureId): readonly Edge[];
  /** Runs accepted so far, seeds and rule runs included. */
  ledgerOkCount(): number;
  /** The rule that caused an accepted run; undefined for a submitted run. */
  ruleOf(runId: RunId): AutoId | undefined;
}

export type ScenarioServerFactory = (
  config: CompiledConfig,
  perms: Perms,
  clock: FakeClock,
  geo: Geo,
  limits: PlanLimits,
) => ScenarioServer;

export function simScenarioServer(server: SimServer): ScenarioServer {
  return {
    config: server.config,
    get head() {
      return server.head;
    },
    submit: (batch, atomic, asBatch) => server.submit(batch, atomic, asBatch),
    seed: (fill) => server.seed(fill),
    observationsSince: (seq) => server.store.log.filter((o) => o.seq > seq),
    snapshot: () => JSON.stringify(server.store.snapshot()),
    feature: (id) => server.store.feature(id),
    edgesFrom: (id) => server.store.edgesFrom(id),
    ledgerOkCount: () => [...server.ledger.values()].filter((e) => e.ok).length,
    ruleOf: (runId) => server.accepted.get(runId)?.rule,
  };
}

export const simServerFactory: ScenarioServerFactory = (config, perms, clock, geo, limits) =>
  simScenarioServer(new SimServer(config, perms, clock, geo, limits));
