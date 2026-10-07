// WP-377: the Auslöser picker round-trips through the file for every trigger it can say (property test).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readRule, writeTrigger, type Trigger, type TriggerEnv } from './trigger';
import { compose, leavesOf } from '../task/when';

const env: TriggerEnv = { type: 'baum', stage: 'stage' };
const key = fc.constantFrom('a', 'b', 'c', 'vitalitaet');
const option = fc.constantFrom('', 'neu', 'kontrolle', 'erledigt');

const trigger: fc.Arbitrary<Trigger> = fc.oneof(
  fc.record({ kind: fc.constant('task' as const), task: key }),
  fc.record({ kind: fc.constant('transition' as const), from: option, to: option }),
  fc.record({
    kind: fc.constant('change' as const),
    properties: fc.uniqueArray(key, { maxLength: 3 }),
    stage: option,
  }),
  fc.record({
    kind: fc.constant('elapsed' as const),
    since: fc.constantFrom('created' as const, 'changed' as const),
    amount: fc.nat(400),
    unit: fc.constantFrom('hours' as const, 'days' as const, 'months' as const),
    stage: fc.constant(''),
  }),
  fc.record({
    kind: fc.constant('elapsed' as const),
    since: fc.constant('entered' as const),
    amount: fc.nat(400),
    unit: fc.constantFrom('hours' as const, 'days' as const, 'months' as const),
    stage: option,
  }),
  fc.record({
    kind: fc.constant('when' as const),
    condition: fc.constantFrom('self.a > 1', "self.vitalitaet == 'tot'", 'self.a != null && self.b == 2'),
  }),
  fc.record({
    kind: fc.constant('schedule' as const),
    cron: fc.constant('*/15 * * * *'),
    idle: fc.constant(0),
  }),
  fc.record({
    kind: fc.constant('schedule' as const),
    cron: fc.constant('0 2 * * *'),
    idle: fc.integer({ min: 1, max: 365 }),
  }),
  fc.record({
    kind: fc.constant('schedule' as const),
    cron: fc.constant('0 2 * * *'),
    idle: fc.integer({ min: 1, max: 365 }),
    stage: fc.constantFrom('neu', 'kontrolle', 'erledigt'),
  }),
);

describe('readRule(writeTrigger(x)) is x', () => {
  it('for every trigger and any extra condition rows (an edge trigger has none: its condition is the whole `when`)', () => {
    fc.assert(
      fc.property(
        trigger,
        fc.constantFrom(undefined, 'self.a > 1', 'self.a > 1 && self.b == 2'),
        (tr, extra) => {
          const w = writeTrigger(tr, env);
          expect(w).toBeDefined();
          if (w === undefined) return;
          const rows = tr.kind === 'when' || extra === undefined ? undefined : extra;
          const when =
            w.edge !== undefined ? w.edge : compose([...w.leaves, ...(rows === undefined ? [] : [rows])]);
          const entry = { ...w.timing, ...(when === undefined ? {} : { when }) };
          const read = readRule({} as never, entry, env);
          expect(read.trigger).toEqual(tr);
          expect(read.rest).toBe(rows);
        },
      ),
    );
  });
});

describe('the shapes of the new choices', () => {
  const run = (tr: Trigger) => writeTrigger(tr, env);
  it('when: no timing key, the condition is the entry `when`', () => {
    const w = run({ kind: 'when', condition: 'self.a > 1' });
    expect(w?.timing).toEqual({});
    expect(w?.edge).toBe('self.a > 1');
  });
  it('hours: `hours(n)`', () => {
    expect(run({ kind: 'elapsed', since: 'changed', amount: 6, unit: 'hours', stage: '' })?.timing).toEqual({
      elapsed: { from: 'self.$changed_at', after: 'hours(6)' },
    });
  });
  it("'Seit: betritt Phase': `changed_at('<stage property>')` and the phase as a pin", () => {
    const w = run({ kind: 'elapsed', since: 'entered', amount: 2, unit: 'days', stage: 'kontrolle' });
    expect(w?.timing).toEqual({ elapsed: { from: "changed_at('stage')", after: 'days(2)' } });
    expect(w?.leaves).toEqual(["self.stage == 'kontrolle'"]);
  });
  it('entered needs a process', () => {
    expect(
      writeTrigger(
        { kind: 'elapsed', since: 'entered', amount: 2, unit: 'days', stage: '' },
        { type: 'baum', stage: undefined },
      ),
    ).toBeUndefined();
  });
  it('a rule written by hand with these shapes shows the matching choice (either quote style)', () => {
    const rule = { elapsed: { from: 'changed_at("stage")', after: 'hours( 3 )' } };
    expect(readRule({} as never, rule, env).trigger).toEqual({
      kind: 'elapsed',
      since: 'entered',
      amount: 3,
      unit: 'hours',
      stage: '',
    });
    expect(readRule({} as never, { when: 'self.a > 1' }, env).trigger).toEqual({
      kind: 'when',
      condition: 'self.a > 1',
    });
  });
  it('anything else shows as the custom trigger and is not overwritten by a condition edit', () => {
    const odd = [
      { elapsed: { from: "changed_at('other')", after: 'days(1)' } },
      { elapsed: { from: 'self.$created_at', after: 'days(1)', offset: '-days(1)' } },
      { elapsed: { from: 'self.due', after: 'days(1)' } },
      { elapsed: { from: 'self.$created_at', after: 'weeks(1)' } },
    ];
    for (const timing of odd) {
      expect(readRule({} as never, timing, env).trigger).toBeUndefined();
    }
  });
});

describe('when parts', () => {
  it('conjuncts split on && only and keep || leaves whole', () => {
    expect(leavesOf('self.a == 1 && (self.b == 2 || self.c == 3)')?.map((l) => l.src)).toEqual([
      'self.a == 1',
      '(self.b == 2 || self.c == 3)',
    ]);
    expect(leavesOf('((')).toBeUndefined();
    expect(leavesOf('')).toEqual([]);
  });
});
