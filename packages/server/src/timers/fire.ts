/**
 * What a due timer becomes: the automatic action's `when` evaluated by core (`autoWhen`,
 * the same function event-triggered entries use in `plan/rules.ts`), then one system run of the action's task.
 */
import {
  actorValue,
  type Actor,
  type CompiledConfig,
  type FeatureId,
  type Json,
  type Key,
  type Run,
} from '@ueberblick/core';
import type { EvalContext, EvalValue, FeatureAccess } from '@ueberblick/core/expr';
import { SYSTEM_ACTOR as CORE_SYSTEM_ACTOR, autoWhen } from '@ueberblick/core/plan';
import type { Geo } from '@ueberblick/core';

/** The actor of a system run, the same as core's rule runs. */
export const SYSTEM_ACTOR: Actor = CORE_SYSTEM_ACTOR;

export const inputValues = (config: CompiledConfig): { readonly [key: string]: Json } =>
  Object.fromEntries(Object.entries(config.file.inputs ?? {}).map(([k, p]) => [k, p.default ?? null]));

export function evalContext(
  config: CompiledConfig,
  features: FeatureAccess,
  geo: Geo,
  now: string,
  vars: ReadonlyMap<string, EvalValue>,
): EvalContext {
  return {
    vars: new Map<string, EvalValue>([
      ['actor', actorValue(SYSTEM_ACTOR)],
      ['inputs', inputValues(config)],
      ...vars,
    ]),
    features,
    now,
    relations: config.relations,
    geo,
  };
}

export type Fired =
  { readonly fire: true; readonly run: Omit<Run, 'id'> } | { readonly fire: false; readonly why: string };

/** Evaluates `when` of the automatic action `autoId` for `subject` (absent for a `schedule`) and builds the system run. */
export function fireRule(
  config: CompiledConfig,
  version: number,
  autoId: string,
  subject: FeatureId | undefined,
  ctxOf: (vars: ReadonlyMap<string, EvalValue>) => EvalContext,
): Fired {
  const auto = config.autos.get(autoId);
  if (auto === undefined)
    return { fire: false, why: `automatic action '${autoId}' is not in config version ${version}` };
  const vars = new Map<string, EvalValue>([['form', {}]]);
  if (subject !== undefined) vars.set('self', { $feature: subject });
  const ctx = ctxOf(vars);
  if (!autoWhen(config, auto, ctx).held) return { fire: false, why: 'when is false' };
  const target = config.file.tasks?.[auto.task];
  return {
    fire: true,
    run: {
      task: auto.task as Key,
      actor: SYSTEM_ACTOR,
      auto: autoId as Key,
      configVersion: version,
      ...(subject !== undefined && target?.on !== '$map' ? { featureId: subject } : {}),
      input: {},
    },
  };
}
