/** v3 effects (task `effects`, rule `do`) become `then` steps; effects that spawn other features become tasks. */
import type { Task } from '@ueberblick/core';
import type { Ctx, TypeInfo } from './ctx';
import { noteTo, valueProp } from './ctx';
import { assignment, quote, type ExprEnv } from './exprs';
import { formulaFor, isFormula } from './formula';
import { slug } from './keys';
import type { Effect, Item } from './model';

/** One `then` step (the schema's `ThenStepSchema`): property key to a value (a string is an expression). */
export interface ThenStep {
  set: Record<string, string | number | boolean | null>;
  when?: string;
  otherwise?: true;
}

/** A feature that an effect spawns: converted to its own task (`on` the source type, `creates` the target). */
export interface Spawn {
  readonly target: TypeInfo;
  readonly then: ThenStep[];
  /** Form of the spawning task: the geometry input when the participant draws the new feature. */
  readonly form?: Task['form'];
}

export interface EffectResult {
  readonly steps: ThenStep[];
  readonly spawns: Spawn[];
  /** The task creates a feature of its own type (v3 "entry" plus a create effect without target). */
  readonly createsSelf: boolean;
}

/** `then` values are typed by v4: strings are expressions. */
export function effectEnv(type: TypeInfo, ctx: Ctx, form: ReadonlySet<string>, noSelf = false): ExprEnv {
  return {
    type,
    base: 'self',
    form,
    ...(noSelf ? { noSelf } : {}),
    role: (r) => ctx.role(r),
    types: (key) => ctx.byKey(key),
  };
}

/** The task that spawns `target` from a feature of `from`: link back, and inherit or draw the geometry. */
function spawnOf(from: TypeInfo, target: TypeInfo, geometry: string | undefined, ctx: Ctx): Spawn {
  const then: ThenStep[] = [];
  const back = target.refTo.get(from.key);
  if (back) then.push({ set: { [back]: 'self' } });
  const mode = geometry ?? 'inherit';
  if (mode === 'inherit' && from.geomKey && target.geomKey) {
    then.push({ set: { [target.geomKey]: `self.${from.geomKey}` } });
  }
  if (mode === 'draw' && target.geomKey) {
    ctx.toolsUsed.add('draw');
    return { target, then, form: { [target.geomKey]: { tool: 'draw', required: true } } };
  }
  return { target, then };
}

/** A computed property is written by the tasks that compute it: their audience may write it, nobody else. */
function allowComputed(type: TypeInfo, prop: string, roles: Set<string> | 'all'): void {
  const known = type.computedBy.get(prop);
  if (roles === 'all' || known === 'all') type.computedBy.set(prop, 'all');
  else type.computedBy.set(prop, new Set([...(known ?? []), ...roles]));
}

export function buildThen(
  items: readonly Item<Effect>[],
  type: TypeInfo,
  ctx: Ctx,
  form: ReadonlySet<string>,
  taskTarget: string,
  isEntry: boolean,
  /** The roles of the participant task that runs the steps; absent for a system task. */
  audience?: Set<string> | 'all',
): EffectResult {
  const steps: ThenStep[] = [];
  const spawns: Spawn[] = [];
  let createsSelf = false;
  const env = effectEnv(type, ctx, form, isEntry);
  for (const { id, v: e } of items) {
    const note = noteTo(ctx.report, id, taskTarget);
    const target = (prop: string) => valueProp(type, prop);
    switch (e.kind) {
      case 'transition': {
        const key = type.stageOptions.get(e.to);
        if (key === undefined) {
          note('dropped', `stage "${e.to}" does not exist`);
          break;
        }
        steps.push({ set: { [type.stageKey]: quote(key) } });
        ctx.report.mapped(id, `${taskTarget}.then`);
        break;
      }
      case 'snapshot':
        note(
          'dropped',
          'v4 history is append-only and hash-chained; there is no separate protocol entry to write',
        );
        break;
      case 'create_instance': {
        const viaProp = e.intoProp ? type.props.get(e.intoProp) : undefined;
        const targetKey = e.workflow
          ? ctx.types.get(e.workflow)
          : viaProp?.to
            ? ctx.byKey(viaProp.to)
            : undefined;
        if (!e.workflow && !e.intoProp) {
          if (isEntry) {
            createsSelf = true;
            ctx.report.mapped(id, `${taskTarget}.creates`);
          } else {
            spawns.push(spawnOf(type, type, e.geometry, ctx));
            note('approximated', 'the spawned feature is created by a separate task offered on the feature');
          }
          break;
        }
        if (!targetKey) {
          note('dropped', 'the feature type to spawn does not exist');
          break;
        }
        spawns.push(spawnOf(type, targetKey, e.geometry, ctx));
        note('approximated', 'the spawned feature is created by a separate task offered on the feature');
        break;
      }
      case 'set_field':
      case 'compute':
      case 'clear_field': {
        const pi = target(e.prop);
        if (!pi) {
          note('dropped', `field "${e.prop}" does not exist`);
          break;
        }
        if (e.kind === 'clear_field') {
          steps.push({ set: { [pi.key]: null } });
          ctx.report.mapped(id, `${taskTarget}.then`);
          break;
        }
        const src = e.kind === 'compute' ? e.expression : (e.expression ?? e.value ?? '');
        const isExpr = e.kind === 'compute' || e.expression !== undefined || isFormula(src);
        const value = isExpr ? formulaFor(src, env, pi, note) : assignment(pi, src, note);
        if (value === undefined) break;
        steps.push({ set: { [pi.key]: value } });
        if (pi.writeMode === 'computed' && audience !== undefined) allowComputed(type, pi.key, audience);
        ctx.report.mapped(id, `${taskTarget}.then`);
        break;
      }
      case 'set_instance_status':
        type.statuses.add(e.status);
        steps.push({ set: { [type.lifecycleKey]: quote(slug(e.status, 's')) } });
        ctx.report.mapped(id, `${taskTarget}.then`);
        break;
      case 'unknown':
        note('dropped', `${e.label} is not known`);
        break;
    }
  }
  return { steps, spawns, createsSelf };
}
