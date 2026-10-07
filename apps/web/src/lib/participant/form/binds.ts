// A task's binds on the device (owner A5, A-047): the bind variables for the form's eval context and the `bound`
// input of `buildFormModel`. The bind expressions are evaluated by core.plan (`bindsFor`, the step `scope()` runs, with
// the actor's visibility guard) and handed in as `resolved`; the Objektart of a bind field comes from core too
// (`boundTypes`). A bind that yields no Objekt on this device (offline, not synced) is `null`, and core.form then
// treats the bind's fields as not relevant, never an error. No expression is evaluated here (R1).
import type { EvalContext, EvalValue } from '@ueberblick/core/expr';
import type { CompiledConfig } from '@ueberblick/core/hydrate';
import { boundTypes } from '@ueberblick/core/plan';
import type { BuildFormInput } from '@ueberblick/ui';

export interface TaskBinds {
  /** The caller's context with the bind variables next to `self`. */
  readonly ctx: EvalContext;
  /** For each bind a form key names: label and properties of the Objektart it yields. */
  readonly bound: NonNullable<BuildFormInput['bound']>;
}

export function taskBinds(
  config: CompiledConfig,
  taskKey: string,
  ctx: EvalContext,
  resolved: ReadonlyMap<string, EvalValue>,
): TaskBinds {
  return {
    ctx: { ...ctx, vars: new Map([...ctx.vars, ...resolved]) },
    bound: boundTypes(config, taskKey as never),
  };
}
