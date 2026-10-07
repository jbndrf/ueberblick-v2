/**
 * The headless simulation session. Compiles the effective file with core, then answers "which tasks
 * are available", "what would this run do" and "what is the state now" using the same core.plan and
 * core.fold as production. This module adds no rules of its own (R1, R2): it wires ports and shapes
 * the output.
 */
import {
  compile,
  NO_ASSETS,
  compilePerms,
  createGeo,
  createPlan,
  oneVersion,
  PLAN_MAX_RULE_DEPTH,
  formApi,
  type CompiledConfig,
  type FeatureId,
  type FeatureState,
  type Key,
  type Observation,
  type PlannedRun,
  type PlanPorts,
  type RulePorts,
  type RecordedObservation,
  type Run,
  type RunId,
  type TemplateFile,
  generateProperties,
  isServed,
} from '@ueberblick/core';
import { MemoryStore } from '@ueberblick/core/memory';
import type {
  FeatureChange,
  FireRuleResult,
  OpenSimulationOptions,
  OpenSimulationResult,
  Simulation,
  SimulatedRun,
  SimulationResult,
  SimulationRun,
  SubmitOptions,
  TaskAvailability,
} from './contract';

export const SIMULATION_NOW = '2026-05-01T08:00:00.000Z';
const SIMULATOR_PARTICIPANT = 'simulator';
const SIMULATOR_CENTER = [7.1, 50.73] as const;

const uuid = (prefix: string, n: number): string =>
  `${prefix}0000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

function describeRuns(
  planned: readonly PlannedRun[],
  recorded: readonly RecordedObservation[],
  dueAt?: string,
): SimulatedRun[] {
  const depth = new Map<RunId, number>();
  const bySeq = new Map<RunId, RecordedObservation[]>();
  for (const o of recorded) bySeq.set(o.runId, [...(bySeq.get(o.runId) ?? []), o]);
  return planned.map((p, i) => {
    const d = p.run.causedBy === undefined ? 0 : (depth.get(p.run.causedBy) ?? 0) + 1;
    depth.set(p.run.id, d);
    const rule = p.rule;
    return {
      runId: p.run.id,
      task: p.run.task,
      actorKind: p.run.actor.kind,
      depth: d,
      ...(p.run.causedBy !== undefined ? { causedBy: p.run.causedBy } : {}),
      ...(rule !== undefined ? { rule } : {}),
      ...(dueAt !== undefined && i === 0 ? { dueAt } : {}),
      observations: bySeq.get(p.run.id) ?? [],
      created: p.created,
    };
  });
}

export function openSimulation(
  file: TemplateFile,
  options: OpenSimulationOptions = {},
): OpenSimulationResult {
  const compiled = compile(file, { assets: NO_ASSETS });
  if (!compiled.ok) return { ok: false, problems: compiled.problems };
  return { ok: true, simulation: createSimulation(compiled.config, options) };
}

export function createSimulation(config: CompiledConfig, options: OpenSimulationOptions = {}): Simulation {
  const now = options.now ?? SIMULATION_NOW;
  const configVersion = options.configVersion ?? 1;
  const geo = createGeo();
  const perms = compilePerms(config);
  const planApi = createPlan(formApi);
  // The simulator has one version (A-029): every feature resolves to it.
  const configFor = oneVersion(config, perms);
  const sandbox = new MemoryStore(config, { now: () => now }, geo, configVersion);
  /** Live features (of `type`), as the simulator lists them. */
  const listOf = (store: MemoryStore, type?: Key): readonly FeatureState[] =>
    [...store.features.values()].filter(
      (f) => isServed(f.lifecycle) && (type === undefined || f.type === type),
    );
  /** Apply observations of any features as one transaction, each recorded under the run `runOf` names. */
  const applyTo = (
    store: MemoryStore,
    observations: readonly Observation[],
    runOf: (o: Observation, index: number) => RunId,
  ): readonly RecordedObservation[] => {
    const recorded = observations.map((o, i): RecordedObservation => ({
      ...o,
      seq: store.head + 1 + i,
      runId: runOf(o, i),
    }));
    store.applyRecorded(recorded);
    return recorded;
  };
  let counter = 0;
  let generated = 0;

  const ports = (facts: PlanPorts['facts'], at: string = now): PlanPorts => ({
    clock: { now: () => at },
    facts,
    geo,
    limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
  });

  const rulePorts = (facts: PlanPorts['facts'], at: string = now): RulePorts => ({
    ...ports(facts, at),
    ids: { runId: () => uuid('1', ++counter) as RunId, featureId: () => uuid('0', ++counter) as FeatureId },
  });

  const tasksFor = (feature: FeatureId): readonly Key[] => {
    const type = sandbox.feature(feature)?.type;
    return type === undefined ? [] : ((config.tasksByType.get(type) ?? []) as readonly Key[]);
  };

  const toAvailability = (task: Key, a: ReturnType<typeof planApi.availableFor>): TaskAvailability =>
    a.ok
      ? { task, ok: true }
      : {
          task,
          ok: false,
          refusal: a.refusal,
          ...(a.explanation !== undefined ? { explanation: a.explanation } : {}),
        };

  const seed = (features: Parameters<Simulation['seed']>[0]): FeatureId[] =>
    features.map((f) => {
      const id = f.id ?? (uuid('0', ++counter) as FeatureId);
      const obs = [
        { featureId: id, property: '$type', result: f.type, resultTime: now },
        ...Object.entries(f.properties).map(([property, result]) => ({
          featureId: id,
          property,
          result,
          resultTime: now,
        })),
      ];
      applyTo(sandbox, obs, () => uuid('1', 0) as RunId);
      return id;
    });

  function submitBatch(runs: readonly SimulationRun[], opts: SubmitOptions = {}): SimulationResult {
    const t0 = performance.now();
    const commit = opts.commit ?? true;
    const target = commit ? sandbox : sandbox.clone();
    const batch: Run[] = runs.map((r) => ({
      id: uuid('1', ++counter) as RunId,
      task: r.task,
      actor: r.actor,
      configVersion,
      input: r.input ?? {},
      ...(r.feature !== undefined ? { featureId: r.feature } : {}),
    }));
    const result = planApi.planFor(batch, configFor, ports(target));
    if (!result.ok) {
      return { ok: false, runId: result.runId, refusal: result.refusal, ms: performance.now() - t0 };
    }
    const { runs: described, changes } = applyPlanned(target, result.runs);
    return { ok: true, runs: described, changes, committed: commit, ms: performance.now() - t0 };
  }

  /** Apply planned runs to `target`, in order, and describe them with the state change of every touched feature. */
  function applyPlanned(
    target: MemoryStore,
    planned: readonly PlannedRun[],
    dueAt?: string,
  ): { runs: SimulatedRun[]; changes: FeatureChange[] } {
    const flat = planned.flatMap((p) => p.observations.map((o) => ({ o, run: p.run.id })));
    const touched = [...new Set(flat.map(({ o }) => o.featureId))];
    const before = new Map(touched.map((id) => [id, target.feature(id)]));
    const recorded = applyTo(
      target,
      flat.map(({ o }) => o),
      (_o, i) => (flat[i] as { run: RunId }).run,
    );
    const changes: FeatureChange[] = touched.flatMap((id) => {
      const after = target.feature(id);
      return after === undefined ? [] : [{ id, before: before.get(id), after }];
    });
    return { runs: describeRuns(planned, recorded, dueAt), changes };
  }

  function fireRule(
    fire: Parameters<Simulation['fireRule']>[0],
    opts: Parameters<Simulation['fireRule']>[1] = {},
  ): FireRuleResult {
    const commit = opts.commit ?? true;
    const target = commit ? sandbox : sandbox.clone();
    const result = planApi.fireRuleFor(
      {
        rule: fire.rule,
        ...(fire.subject !== undefined ? { subject: fire.subject } : {}),
        configVersion,
        dueAt: fire.dueAt,
      },
      configFor,
      rulePorts(target, opts.now),
      { trace: true },
    );
    const trace = result.trace ?? [];
    if (!result.ok) return { ok: false, refusal: result.refusal, trace };
    return { ok: true, runs: applyPlanned(target, result.runs, fire.dueAt).runs, trace, committed: commit };
  }

  return {
    config,
    geo,
    facts: sandbox,
    factsAfter(observations) {
      const copy = sandbox.clone();
      applyTo(copy, observations, () => uuid('1', 0) as RunId);
      return copy;
    },
    features: (type) => listOf(sandbox, type),
    feature: (id) => sandbox.feature(id),
    seed,
    generate(type, overrides = {}) {
      const props = config.file.types?.[type]?.properties ?? {};
      const values = generateProperties(props, {
        n: generated++,
        featureOf: (t) => listOf(sandbox, t as Key)[0]?.id,
        participant: SIMULATOR_PARTICIPANT,
        center: SIMULATOR_CENTER,
        rng: () => 0.5,
      });
      const [id] = seed([{ type, properties: { ...values, ...overrides } }]);
      return id as FeatureId;
    },
    availability: (feature, actor) =>
      tasksFor(feature).map((task) =>
        toAvailability(task, planApi.availableFor(task, { feature }, actor, configFor, ports(sandbox))),
      ),
    availabilityWithout: (task, actor) => {
      const offer =
        config.file.tasks?.[task]?.on === '$none' ? { none: true as const } : { map: true as const };
      return toAvailability(task, planApi.availableFor(task, offer, actor, configFor, ports(sandbox)));
    },
    fireRule,
    submit: (run, opts) => submitBatch([run], opts),
    submitBatch,
  };
}
