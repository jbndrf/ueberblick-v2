/**
 * core.plan: run → observations | refusal (docs/03 "life of a run"; contract in `contract.ts`).
 * `createPlan(form)` takes core.form so this module never re-implements form semantics (R1).
 */
import type { FormApi } from '../form/contract';
import { createFold } from '../fold';
import type { FoldSchema } from '../fold/contract';
import { foldSchema } from '../schema/compile/views';
import { autoPath } from '../schema/compile/autos';
import type { Actor, FeatureId, Key, Run, RunId } from '../model';
import type { Ids } from '../ports';
import { seededIds } from './seeded-ids';
import { NEW_FEATURE } from './contract';
import type {
  ConfigFor,
  FireResult,
  PlanApi,
  PlanPorts,
  PlanResult,
  PlannedRun,
  RuleTraceEntry,
  TaskTarget,
} from './contract';
import type { EvalContext, EvalValue } from '../expr/contract';
import {
  CORRECT_TASK,
  CREATE_TASK,
  IMPORT_TASK,
  LIFECYCLE_TASK,
  MOVE_TASK,
  PIN_TASK,
  RECOMPUTE_TASK,
  SEED_TASK,
} from '../registry/system-tasks';
import { planRecompute } from './computed';
import { planCorrect } from './correct-task';
import { planCreate } from './create-task';
import { planImportTask } from './import-task';
import { planLifecycleTask } from './lifecycle-task';
import { planMove } from './move';
import { planPin } from './pin';
import { planSeed } from './seed';
import { Overlay } from './overlay';
import { envAt } from './resolve';
import { planRun } from './run';
import { fireOne, SYSTEM_ACTOR } from './rules';
export { SYSTEM_ACTOR } from './rules';
export { autoWhen, type AutoWhen } from './auto-eval';
import { availability, bindVars, guardedContext, inputValues, ref, refuse, type Env } from './scope';

export type * from './contract';
export { NEW_FEATURE, PLAN_MAX_RULE_DEPTH, oneVersion } from './contract';
export { seededIds } from './seeded-ids';
export { featureAccess } from './access';
export { quotaOfRoles } from './quota';
export { PlanConfigError, boundTypes, type BoundType } from './scope';

/** The availability checks mint nothing: only a plan or a timer rule run creates ids. */
const NO_IDS: Ids = {
  runId: () => {
    throw new Error('availability mints no ids');
  },
  featureId: () => {
    throw new Error('availability mints no ids');
  },
};

/** What the device form needs next to `PlanApi`: the binds of a task, resolved exactly as `scope` does. */
export interface BindApi {
  /**
   * The binds of `task` for this target and actor, by name; `null` where the expression yields no Objekt the actor
   * may see. Empty for an unknown task. Never refuses: the participant form hides the bind's fields instead.
   */
  bindsFor(
    task: Key,
    target: TaskTarget,
    actor: Actor,
    configFor: ConfigFor,
    ports: PlanPorts,
  ): ReadonlyMap<string, EvalValue>;
  /**
   * The expression context of a task's form for this target and actor: `actor`, `inputs`, `self`, read through the
   * same guard `scope()` uses (`guardedContext`), so an Objekt the actor may not see reads as absent (WP-816).
   */
  contextFor(target: TaskTarget, actor: Actor, configFor: ConfigFor, ports: PlanPorts): EvalContext;
}

export function createPlan(form: FormApi): PlanApi & BindApi {
  /** The env of one call: the overlay folds under the deployed version (`NEW_FEATURE`), `envAt` gives the per-feature views. */
  const env = (configFor: ConfigFor, ports: PlanPorts, ids: Ids, trace?: RuleTraceEntry[]): Env => {
    const deployed = configFor(NEW_FEATURE);
    const { config, perms, version } = deployed;
    const schema = foldSchema(config, 0);
    // The overlay folds each feature under its own version (A-029), so a pinned feature of a type the deployed config
    // removed still folds. The views are the ones `envAt` caches: the resolver is still called once per key.
    const schemas = new WeakMap<Env, FoldSchema>();
    const schemaOf = (id: FeatureId): FoldSchema => {
      const view = envAt(base, id);
      let s = schemas.get(view);
      if (s === undefined) schemas.set(view, (s = foldSchema(view.config, view.version ?? 0)));
      return s;
    };
    const base: Env = {
      config,
      perms,
      ports,
      ids,
      overlay: new Overlay(ports.facts, createFold(ports.geo), schema, config, ports, schemaOf),
      form,
      inputs: inputValues(config),
      created: new Map<string, number>(),
      version,
      configFor,
      views: new Map<string, Env>(),
      fresh: new Set<FeatureId>(),
      ...(trace !== undefined ? { trace } : {}),
    };
    base.views.set(NEW_FEATURE, base);
    return base;
  };

  const api: PlanApi & BindApi = {
    bindsFor(task, target, actor, configFor, ports) {
      const subject = 'feature' in target ? target.feature : undefined;
      const e = envAt(env(configFor, ports, NO_IDS), subject);
      return bindVars(e, task, new Map(subject === undefined ? [] : [['self', ref(subject)]]), actor);
    },

    contextFor(target, actor, configFor, ports) {
      const subject = 'feature' in target ? target.feature : undefined;
      const e = envAt(env(configFor, ports, NO_IDS), subject);
      return guardedContext(e, actor, new Map(subject === undefined ? [] : [['self', ref(subject)]]));
    },

    availableFor(task, target, actor, configFor, ports) {
      const e = env(configFor, ports, NO_IDS);
      return availability(envAt(e, 'feature' in target ? target.feature : undefined), task, target, actor);
    },

    availableTasksFor(feature: FeatureId, actor: Actor, configFor, ports): readonly Key[] {
      const e = envAt(env(configFor, ports, NO_IDS), feature);
      const type = ports.facts.feature(feature)?.type;
      if (type === undefined) return [];
      return (e.config.tasksByType.get(type) ?? []).filter(
        (t) => availability(e, t as Key, { feature }, actor).ok,
      ) as Key[];
    },

    fireRuleFor(fire, configFor, ports, options): FireResult {
      const e = envAt(
        env(configFor, ports, ports.ids, options?.trace === true ? [] : undefined),
        fire.subject,
      );
      const auto = e.config.autos.get(fire.rule);
      if (auto === undefined || (auto.kind !== 'elapsed' && auto.kind !== 'schedule')) {
        return {
          ok: false,
          refusal: refuse(
            'not_available',
            `'${fire.rule}' is not a time-based automatic action`,
            auto === undefined ? fire.rule : autoPath(auto),
          ),
        };
      }
      const origin = {
        actor: SYSTEM_ACTOR,
        configVersion: e.version ?? fire.configVersion,
        clientTime: ports.clock.now(),
        trigger: { kind: 'timer', dueAt: fire.dueAt },
      } as const;
      const r = fireOne(e, fire.rule, fire.subject, {}, origin, 0, planRun);
      return e.trace ? { ...r, trace: e.trace } : r;
    },

    planFor(batch: readonly Run[], configFor, ports, options): PlanResult {
      const trace: RuleTraceEntry[] | undefined = options?.trace === true ? [] : undefined;
      // Created ids are a pure function of the submitted run (`seededIds`), never of the `ids` port: a device and a
      // server that plan the same run agree on every created feature and rule run, whatever the batch (WP-748).
      let current = seededIds(batch[0]?.id as RunId);
      const mint: Ids = { runId: () => current.runId(), featureId: () => current.featureId() };
      const e = env(configFor, ports, mint, trace);
      const runs: PlannedRun[] = [];
      for (const run of batch) {
        current = seededIds(run.id);
        const r =
          run.task === MOVE_TASK
            ? planMove(run, ports.facts, envAt(e, run.featureId).config)
            : run.task === PIN_TASK
              ? planPin(run, ports.facts)
              : run.task === SEED_TASK
                ? planSeed(run, e)
                : run.task === RECOMPUTE_TASK
                  ? planRecompute(envAt(e, run.featureId), run)
                  : run.task === IMPORT_TASK
                    ? planImportTask(e, run)
                    : run.task === LIFECYCLE_TASK
                      ? planLifecycleTask(run, ports.facts)
                      : run.task === CORRECT_TASK
                        ? planCorrect(e, run)
                        : run.task === CREATE_TASK
                          ? planCreate(e, run)
                          : planRun(e, run, 0);
        if (!r.ok) return { ok: false, runId: run.id, refusal: r.refusal, ...(trace ? { trace } : {}) };
        runs.push(...r.runs);
      }
      return { ok: true, runs, ...(trace ? { trace } : {}) };
    },
  };
  return api;
}
