/**
 * Which task an OGC API write runs (A-017): the seam between "QGIS changed these properties" and "a run of a
 * configured task". An explicit `?task=` wins. Otherwise the candidate must be UNIQUE: for a create, a task that
 * creates the type; for an update, a task offered on the type whose form covers every changed property. Only tasks the
 * actor may run count. None or several is an answer (a list), never a guess such as "the first in config order".
 * A delete runs a task offered on the type whose only effect is `lifecycle: deleted` (A-028, WP-305); without one it
 * has no candidate (422).
 */
import type { Actor, CompiledConfig, FeatureId, Key } from '@ueberblick/core';

export type WriteChange =
  | { readonly kind: 'create'; readonly keys: readonly string[] }
  | { readonly kind: 'update'; readonly feature: FeatureId; readonly keys: readonly string[] }
  | { readonly kind: 'delete'; readonly feature: FeatureId };

export type TaskTarget = { readonly feature: FeatureId } | { readonly map: true } | { readonly none: true };

export type WriteTaskResult =
  | { readonly ok: true; readonly task: Key }
  | {
      readonly ok: false;
      readonly candidates: readonly Key[];
      readonly reason: string;
      /** Tasks exist for this change but none the actor may run carries it: a permission refusal for a participant (403). */
      readonly denied?: true;
    };

/** Whether `task` may run for `actor` on `target` (core `plan.available`); the caller closes over config, perms, ports. */
export type Availability = (task: Key, target: TaskTarget) => boolean;

export function resolveWriteTask(
  config: CompiledConfig,
  type: string,
  change: WriteChange,
  actor: Actor,
  hint: string | undefined,
  available: Availability,
): WriteTaskResult {
  void actor; // availability already carries the actor; kept so the seam can grow (teams, O12)
  const tasks = config.file.tasks ?? {};
  const target = (k: Key): TaskTarget => {
    if (change.kind !== 'create') return { feature: change.feature };
    return tasks[k]?.on === '$map' ? { map: true } : { none: true };
  };
  const offered = (k: string): boolean => {
    const t = tasks[k];
    if (t === undefined) return false;
    if (change.kind === 'delete') {
      const steps = t.then ?? [];
      return (
        t.creates === undefined &&
        (config.tasksByType.get(type) ?? []).includes(k) &&
        steps.length > 0 &&
        steps.some((s) => s.of === undefined) &&
        steps.every((s) => s.of !== undefined || s.lifecycle === 'deleted')
      );
    }
    if (change.kind === 'create') return t.creates === type && (t.on === '$map' || t.on === '$none');
    return t.creates === undefined && (config.tasksByType.get(type) ?? []).includes(k);
  };
  if (hint !== undefined) {
    if (!offered(hint))
      return {
        ok: false,
        candidates: [],
        reason: `Task '${hint}' is not a task that ${{ create: 'creates', update: 'changes', delete: 'deletes' }[change.kind]} ${type}.`,
      };
    return { ok: true, task: hint as Key };
  }
  const covers = (k: string): boolean => {
    const form = Object.keys(tasks[k]?.form ?? {});
    return change.kind === 'delete' || change.keys.every((key) => form.includes(key));
  };
  const usable = Object.keys(tasks).filter((k) => offered(k) && available(k as Key, target(k as Key)));
  const fits = usable.filter(covers);
  const denied = fits.length === 0 && Object.keys(tasks).some(offered);
  if (fits.length === 1) return { ok: true, task: fits[0] as Key };
  const list = (fits.length > 0 ? fits : usable) as Key[];
  const what = { create: 'creates', update: 'changes', delete: 'deletes' }[change.kind];
  return {
    ok: false,
    candidates: fits as Key[],
    ...(denied ? { denied: true as const } : {}),
    reason:
      fits.length === 0
        ? `No task you may run ${what} ${type} with ${change.kind === 'delete' ? 'it' : change.keys.length === 0 ? 'these values' : `the properties ${change.keys.join(', ')}`}${list.length > 0 ? `; tasks on ${type}: ${list.join(', ')}` : ''}. Choose with ?task=.`
        : `Several tasks fit (${fits.join(', ')}). Choose one with ?task=.`,
  };
}
