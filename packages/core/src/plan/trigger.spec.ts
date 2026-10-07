// WP-566: the rule trace trigger is discriminated on a registry; every kind is handled.
import { describe, expect, it } from 'vitest';
import { RULE_TRACE_TRIGGER_KINDS, type RuleTraceTriggerKind } from '../registry/rule-trace';
import type { RuleTraceTrigger } from './contract';

/** Total over the registry: adding a kind without handling it here fails the typecheck (`never`). */
function describeTrigger(t: RuleTraceTrigger): string {
  switch (t.kind) {
    case 'run':
      return `run ${t.causedBy}`;
    case 'timer':
      return `timer ${t.dueAt}`;
    default: {
      const unhandled: never = t;
      return unhandled;
    }
  }
}

describe('RuleTraceTrigger', () => {
  it('registry kinds are run and timer', () => {
    expect([...RULE_TRACE_TRIGGER_KINDS.keys].sort()).toEqual(['run', 'timer']);
  });

  it('the trigger type discriminates on exactly the registry kinds', () => {
    const kinds: readonly RuleTraceTrigger['kind'][] = RULE_TRACE_TRIGGER_KINDS.keys;
    const back: readonly RuleTraceTriggerKind[] = kinds;
    expect(back).toHaveLength(2);
  });

  it('every registry kind is handled by a switch with a never check', () => {
    const samples: Record<RuleTraceTriggerKind, RuleTraceTrigger> = {
      run: { kind: 'run', causedBy: 'r1' as never },
      timer: { kind: 'timer', dueAt: '2026-10-01T06:00:00Z' },
    };
    for (const key of RULE_TRACE_TRIGGER_KINDS.keys) expect(describeTrigger(samples[key])).toContain(key);
  });
});
