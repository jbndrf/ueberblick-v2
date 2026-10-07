// WP-336: a task's `when` as the pane edits it: a stage pin and the rest. The roles are the task's `who` (WP-1047).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parse } from '@ueberblick/core/expr/compile';
import { stageOf, withStage } from './when';

describe('stageOf and withStage', () => {
  it('reads the pinned stage', () => {
    expect(stageOf(undefined, 'stage')).toEqual({ ok: true, options: [] });
    expect(stageOf("self.stage == 'erfasst'", 'stage')).toEqual({ ok: true, options: ['erfasst'] });
    expect(stageOf("self.stage in ['a', 'b'] && self.h > 3", 'stage')).toEqual({
      ok: true,
      options: ['a', 'b'],
    });
    expect(stageOf("self.other == 'x'", 'stage')).toEqual({ ok: true, options: [] });
  });

  it('pins, replaces and unpins, keeping the other conditions', () => {
    expect(withStage(undefined, 'stage', 'a')).toBe("self.stage == 'a'");
    expect(withStage("self.stage == 'a' && self.h > 3", 'stage', 'b')).toBe(
      "self.stage == 'b' && self.h > 3",
    );
    expect(withStage('self.h > 3', 'stage', 'a')).toBe("self.stage == 'a' && self.h > 3");
    expect(withStage("self.stage == 'a' && self.h > 3", 'stage', undefined)).toBe('self.h > 3');
    expect(withStage("self.stage == 'a'", 'stage', undefined)).toBeUndefined();
  });

  it('refuses a condition whose top level is an ||', () => {
    expect(stageOf("self.stage == 'a' || self.h > 3", 'stage').ok).toBe(false);
    expect(withStage("self.stage == 'a' || self.h > 3", 'stage', 'b')).toBe(false);
    expect(withStage("'a' in actor.roles || 'b' in actor.roles", 'stage', 'x')).toBe(false);
  });
});

const others = fc.constantFrom(
  undefined,
  "self.stage == 'aktiv'",
  "self.h > 3 && self.stage != 'erledigt'",
  'self.h > 3',
);
const options = fc.constantFrom('a', 'b', 'c', undefined);

describe('properties', () => {
  it('withStage then stageOf gives the pin back, and the result still parses', () => {
    fc.assert(
      fc.property(others, options, options, (o, first, second) => {
        const one = withStage(o, 'stage', first);
        if (one === false) throw new Error('refused');
        const two = withStage(one, 'stage', second);
        if (two === false) throw new Error('refused');
        expect(stageOf(two, 'stage')).toEqual({ ok: true, options: second === undefined ? [] : [second] });
        if (two) expect(parse(two).ok).toBe(true);
      }),
    );
  });
});
