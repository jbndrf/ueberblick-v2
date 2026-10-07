/** Simulation harness (WP-050): in-memory fake ports, a seeded simulator and its invariants. Test-only; not part of the core barrel. */
export type * from './contract';
export { createRng } from './prng';
export { createClock, createIds, SEED_RUN, SIM_CONFIG_VERSION, type FakeClock } from './ids';
export { SimServer } from './server';
export {
  simScenarioServer,
  simServerFactory,
  type ScenarioServer,
  type ScenarioServerFactory,
} from './scenario-server';
export { SimDevice } from './device';
export { SimNetwork } from './network';
export { checkInvariants, type CheckInput } from './invariants';
export { simulate, simulateWorld, DEFAULT_OPTIONS, START, type SimWorld } from './sim';
export {
  Aliases,
  embedGoldenRefs,
  embedGoldenSource,
  goldenAssets,
  goldenConfig,
  goldenFiles,
  goldenYaml,
  newestTemplate,
  seedFeatures,
  type SeedFeatures,
} from './golden';
export { baumWorkload } from './workloads';
export { describeFactsConformance, type FactsHarness } from './facts-conformance';
export * as factsKit from './facts-conformance-kit';
