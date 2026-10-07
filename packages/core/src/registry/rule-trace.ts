import { defineRegistry, type KeyOf } from './define';

/** What became of one rule considered while planning a batch (docs/03 "Rule trace"). */
export const RULE_TRACE_REASONS = defineRegistry([
  { key: 'fired', description: 'The trigger matched, `when` held and the rule run was planned.' },
  { key: 'trigger_not_matched', description: 'No change of the causing run matches the rule trigger.' },
  {
    key: 'already_true',
    description:
      'A `{ when }` trigger held before the run and still holds: it fired earlier and is not re-armed.',
  },
  { key: 'when_false', description: 'The trigger matched but the rule `when` is false (see `explanation`).' },
  { key: 'depth_exceeded', description: 'Firing would nest rule runs deeper than the platform limit.' },
  { key: 'refused', description: 'The rule fired but its `with` or its run was refused (see `refusal`).' },
] as const);

export type RuleTraceReason = KeyOf<typeof RULE_TRACE_REASONS>;

/**
 * What set a rule going, as a rule trace entry records it (docs/03 "Rule trace"). Not the config trigger forms
 * (`AUTO_TIMING_KINDS`, what an automatic action declares): this says why *this* evaluation happened. Later kinds
 * (import, external event, dispatch) are one more entry here and one more case where the trace is read.
 */
export const RULE_TRACE_TRIGGER_KINDS = defineRegistry([
  { key: 'run', description: 'A run whose changes were checked against an event rule (`causedBy`).' },
  { key: 'timer', description: 'A time-based rule that came due (`dueAt`).' },
] as const);

export type RuleTraceTriggerKind = KeyOf<typeof RULE_TRACE_TRIGGER_KINDS>;
