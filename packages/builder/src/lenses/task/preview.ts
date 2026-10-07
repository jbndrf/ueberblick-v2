/**
 * The live preview (docs/08 "Task"): the participant's form for the task, drawn by the form renderer
 * of `packages/ui` over a session that core.form drives (R1: relevance, required and calculate are
 * core's, never the lens's). `self` is a generated feature of the sandbox (`openSimulation`), the
 * actor is one participant with a chosen role (H3: a role app profile later supplies the same
 * input). The task's bind variables are core.plan's `bindsFor` (the one the device reads, R1), so a
 * form expression reading one evaluates as on the device; a bind that yields no Objekt is `null`.
 */
import {
  actorValue,
  compilePerms,
  createPlan,
  featureAccess,
  formApi,
  oneVersion,
  PLAN_MAX_RULE_DEPTH,
  type Actor,
  type Json,
  type Key,
  type LocalizedString,
  type TemplateFile,
} from '@ueberblick/core';
import type { EvalValue } from '@ueberblick/core/expr';
import { boundTypes } from '@ueberblick/core/plan';
import { buildFormModel, createFormSession, FormModelError, type FormSession } from '@ueberblick/ui';
import { labelOf } from '../../shell/location';
import { openSimulation, SIMULATION_NOW } from '../../simulate';

export type PreviewFailure =
  | { readonly ok: false; readonly reason: 'no_task' }
  | { readonly ok: false; readonly reason: 'does_not_compile' }
  | { readonly ok: false; readonly reason: 'form_model'; readonly message: string };

export type Preview = { readonly ok: true; readonly session: FormSession } | PreviewFailure;

/** Who the preview can be shown as: one entry per role of the file. */
export function previewRoles(
  file: TemplateFile,
): readonly { readonly value: string; readonly label: string }[] {
  return Object.entries(file.roles ?? {}).map(([key, r]) => ({
    value: key,
    label: labelOf(r.label as LocalizedString | undefined, 'en', key),
  }));
}

/** The session of the form of `task`, for a participant with `role`. */
export function buildPreview(file: TemplateFile, task: string, role: string, locale: string): Preview {
  const def = file.tasks?.[task];
  if (def === undefined) return { ok: false, reason: 'no_task' };
  const opened = openSimulation(file, { now: SIMULATION_NOW });
  if (!opened.ok) return { ok: false, reason: 'does_not_compile' };
  const sim = opened.simulation;
  const onType = typeof def.on === 'string' ? def.on : def.on[0];
  const hasSelf = onType !== undefined && file.types?.[onType] !== undefined;
  const type = (def.creates ?? (hasSelf ? onType : undefined)) as Key | undefined;
  const actor: Actor = { id: 'preview', kind: 'participant', roles: [role as Key] };
  const vars = new Map<string, EvalValue>([
    ['actor', actorValue(actor) as Json],
    [
      'inputs',
      Object.fromEntries(Object.entries(file.inputs ?? {}).map(([k, p]) => [k, p.default ?? null])) as Json,
    ],
  ]);
  const self = hasSelf ? sim.generate(onType as Key) : undefined;
  if (self !== undefined) vars.set('self', { $feature: self });
  const binds = createPlan(formApi).bindsFor(
    task as Key,
    self === undefined ? { none: true } : { feature: self },
    actor,
    oneVersion(sim.config, compilePerms(sim.config)),
    {
      clock: { now: () => SIMULATION_NOW },
      facts: sim.facts,
      geo: sim.geo,
      limits: { ruleDepth: PLAN_MAX_RULE_DEPTH },
    },
  );
  for (const [name, value] of binds) vars.set(name, value);
  try {
    const model = buildFormModel({
      form: def.form ?? {},
      properties: type === undefined ? {} : (file.types?.[type]?.properties ?? {}),
      bound: boundTypes(sim.config, task as Key),
    });
    const session = createFormSession(model, {
      task: task as Key,
      config: sim.config,
      ctx: {
        vars,
        features: featureAccess(sim.facts, sim.config),
        now: SIMULATION_NOW,
        relations: sim.config.relations,
        geo: sim.geo,
      },
      ...(type !== undefined ? { type } : {}),
      locale,
    });
    return { ok: true, session };
  } catch (e) {
    if (e instanceof FormModelError) return { ok: false, reason: 'form_model', message: e.message };
    throw e;
  }
}
