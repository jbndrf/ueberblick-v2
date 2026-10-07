// WP-780/WP-781: the one replay binding the simulated server and the run store's ledger share.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Run } from '../model';
import { bindingFieldsOf, sameRunBinding as same, type RunBindingFields } from './binding';

const sameRunBinding = (a: Run, b: Run): boolean => same(bindingFieldsOf(a), bindingFieldsOf(b));

const run = (over: Partial<Run> = {}): Run =>
  ({
    id: 'r1',
    task: 'befund_ergaenzen',
    actor: { id: 'anna', kind: 'participant', roles: [] },
    input: { a: 1, b: { c: 2, d: 3 } },
    featureId: 'f1',
    clientTime: '2026-05-01T08:00:00Z',
    configVersion: 1,
    ...over,
  }) as unknown as Run;

describe('sameRunBinding', () => {
  it('is true for the same actor, task, feature and payload, whatever the key order or client time', () => {
    const again = run({
      input: { b: { d: 3, c: 2 }, a: 1 },
      clientTime: '2026-05-02T00:00:00Z',
    } as Partial<Run>);
    expect(sameRunBinding(run(), again)).toBe(true);
  });

  it('is false for another actor, actor kind, task, feature or payload', () => {
    expect(
      sameRunBinding(run(), run({ actor: { id: 'bernd', kind: 'participant', roles: [] } } as Partial<Run>)),
    ).toBe(false);
    expect(
      sameRunBinding(run(), run({ actor: { id: 'anna', kind: 'import', roles: [] } } as Partial<Run>)),
    ).toBe(false);
    expect(sameRunBinding(run(), run({ task: 'andere' } as Partial<Run>))).toBe(false);
    expect(sameRunBinding(run(), run({ featureId: 'f2' } as Partial<Run>))).toBe(false);
    expect(sameRunBinding(run(), run({ input: { a: 2 } } as Partial<Run>))).toBe(false);
  });

  it('a retry that names no feature still matches', () => {
    const { featureId, ...rest } = run();
    const bare: Run = rest;
    expect(featureId).toBeDefined();
    expect(sameRunBinding(run(), bare)).toBe(true);
  });

  it('is symmetric in payload order (property)', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string(), fc.integer()), (input) => {
        const rev = Object.fromEntries(Object.entries(input).reverse());
        expect(sameRunBinding(run({ input } as Partial<Run>), run({ input: rev } as Partial<Run>))).toBe(
          true,
        );
      }),
    );
  });

  it('an incoming run with causedBy binds to nothing (decided: submitted runs never have one)', () => {
    expect(sameRunBinding(run(), run({ causedBy: 'r0' } as Partial<Run>))).toBe(false);
  });

  it('a held run with causedBy binds to nothing', () => {
    expect(sameRunBinding(run({ causedBy: 'r0' } as Partial<Run>), run())).toBe(false);
  });

  it('the held feature may be a projection: the created feature matches a retry that names it', () => {
    const held: RunBindingFields = { ...bindingFieldsOf(run()), featureId: 'created-1' };
    const again = bindingFieldsOf(run({ featureId: 'created-1' } as Partial<Run>));
    expect(same(held, again)).toBe(true);
    expect(same(held, { ...again, featureId: 'f1' })).toBe(false);
  });
});
