/**
 * The automatic actions view (docs/08 "Aktionen"): a pure function of the Doc over core's table of automatic actions
 * (`listAutos`, C-004). Each `tasks.<task>.auto.<name>` is read as when (timing) → if (condition) → then (run
 * its task). The condition is parsed and shown as chips by core (`toChips`), and stays text when chips could not give
 * back the same tree (R5: one language, no second interpretation here).
 */
import {
  AUTO_TIMING_KINDS,
  autoPath,
  listAutos,
  type AutoTimingKind,
  type Provenance,
} from '@ueberblick/core';
import type { Doc } from '../../doc';
import { conditionOf, type ConditionView } from '../../shell/conditions';
import { labelOf } from '../../shell/location';

/** A timing as data; the component words it (Paraglide). `serverOnly` follows the registry (`AUTO_TIMING_KINDS`): true for the clock, false for `edge`, which the planner evaluates. */
export type TriggerView =
  | { readonly kind: Extract<AutoTimingKind, 'after'>; readonly task: string }
  | { readonly kind: Extract<AutoTimingKind, 'change'>; readonly type: string; readonly property: string }
  | { readonly kind: Extract<AutoTimingKind, 'edge'>; readonly condition: string }
  | { readonly kind: Extract<AutoTimingKind, 'elapsed'>; readonly from: string }
  | { readonly kind: Extract<AutoTimingKind, 'schedule'>; readonly schedule: string };

export interface RuleView {
  /** The automatic action id, `<task>.<name>`: what a selection of the action names. */
  readonly key: string;
  /** The task it belongs to and runs. */
  readonly run: string;
  readonly runLabel: string;
  /** Its name among the task's automatic actions. */
  readonly name: string;
  readonly label: string;
  readonly trigger: TriggerView;
  /** The timing in the file's own words: `after: kontrolle`, `change: baum.stage`; empty for a time timing. */
  readonly triggerText: string;
  /** Set when the timing is `after`: the task's label. */
  readonly taskLabel?: string;
  readonly serverOnly: boolean;
  /** The entry `when` as chips; absent for an edge entry, whose `when` is its trigger. */
  readonly when?: ConditionView;
  readonly provenance: Provenance;
}

type Entry = ReturnType<typeof listAutos>[number]['entry'];

export function triggerOf(entry: Entry): TriggerView {
  if (entry.after !== undefined) return { kind: 'after', task: entry.after };
  if (entry.change !== undefined) {
    const [type = '', ...rest] = entry.change.split('.');
    return { kind: 'change', type, property: rest.join('.') };
  }
  if (entry.elapsed !== undefined) return { kind: 'elapsed', from: entry.elapsed.from };
  if (entry.schedule !== undefined) return { kind: 'schedule', schedule: entry.schedule };
  return { kind: 'edge', condition: entry.when ?? '' };
}

export function buildRules(doc: Doc, locale: string): readonly RuleView[] {
  const file = doc.effective();
  return listAutos(file).map((a): RuleView => {
    const trigger = triggerOf(a.entry);
    const taskLabel =
      trigger.kind === 'after' ? labelOf(file.tasks?.[trigger.task]?.label, locale, trigger.task) : undefined;
    return {
      key: a.id,
      run: a.task,
      runLabel: labelOf(file.tasks?.[a.task]?.label, locale, a.task),
      name: a.name,
      label: labelOf(a.entry.label, locale, a.name),
      trigger,
      triggerText: a.entry.after !== undefined ? `after: ${a.entry.after}` : (a.entry.change ?? ''),
      ...(taskLabel !== undefined ? { taskLabel } : {}),
      serverOnly: AUTO_TIMING_KINDS.get(trigger.kind).server_only,
      ...(a.entry.when !== undefined && a.kind !== 'edge' ? { when: conditionOf(a.entry.when) } : {}),
      provenance: doc.provenance(autoPath(a)),
    };
  });
}
