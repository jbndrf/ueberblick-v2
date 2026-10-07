import { describe, expect, it } from 'vitest';
import { VERSION_DEPLOY_DEFAULT } from '@ueberblick/core';
import {
  choicesToSend,
  choosable,
  holdOf,
  mappingsToSend,
  missingPicks,
  needsPick,
  requestOf,
} from './overview-model';
import type { DeployPlan, MappingView } from './types';

const stageRow: MappingView = {
  path: 'types.baum.properties.stage.options.massnahme',
  name: 'Maßnahme',
  type: 'baum',
  stage: true,
  affected: 4,
  choices: [{ key: 'erfasst', label: 'Erfasst' }],
};
const plan = (over: Partial<DeployPlan> = {}): DeployPlan => ({
  revision: 7,
  first: false,
  warnings: [],
  groups: [{ type: 'baum', label: 'Baum', isNew: false, isRemoved: false, objects: 9, entries: [] }],
  versions: [{ type: 'baum', running_floating: 4, already_pinned: 1, settled_floating: 0 }],
  mappings: [stageRow],
  blockers: [],
  ...over,
});

describe('the choice "belassen / verschieben"', () => {
  it('is offered only for an Objektart with running Objekte, and defaults to the engine default', () => {
    const p = plan({
      versions: [
        { type: 'baum', running_floating: 4, already_pinned: 0, settled_floating: 0 },
        { type: 'zaun', running_floating: 0, already_pinned: 2, settled_floating: 3 },
      ],
    });
    expect(choosable(p)).toEqual(['baum']);
    expect(choicesToSend(p, {})).toEqual({ baum: VERSION_DEPLOY_DEFAULT });
    expect(choicesToSend(p, { baum: 'keep' })).toEqual({ baum: 'keep' });
  });
});

describe('mappings', () => {
  it('a removed stage with Objekte needs a pick; the pick goes into the request', () => {
    expect(needsPick(plan(), {}, stageRow)).toBe(true);
    expect(holdOf(plan(), {}, {})).toBe('needs_pick');
    const picks = { [stageRow.path]: { to: 'erfasst' } };
    expect(holdOf(plan(), {}, picks)).toBeNull();
    expect(requestOf(plan(), {}, picks)).toEqual({
      revision: 7,
      mappings: { [stageRow.path]: { to: 'erfasst' } },
      versions: { baum: VERSION_DEPLOY_DEFAULT },
    });
  });

  it('an entry nobody holds, needs no pick and is sent as "Werte verwerfen"', () => {
    const p = plan({ mappings: [{ ...stageRow, affected: 0 }] });
    expect(missingPicks(p, {}, {})).toEqual([]);
    expect(mappingsToSend(p, {}, {})).toEqual({ [stageRow.path]: { discard: true } });
    expect(holdOf(p, {}, {})).toBeNull();
  });

  it('when the Objektart is kept and nothing settled floats, its rows need no pick', () => {
    expect(needsPick(plan(), { baum: 'keep' }, stageRow)).toBe(false);
    const settled = plan({
      versions: [{ type: 'baum', running_floating: 4, already_pinned: 0, settled_floating: 2 }],
    });
    expect(needsPick(settled, { baum: 'keep' }, stageRow)).toBe(true);
  });

  it('a row with nothing to move to still takes "Werte verwerfen" as an explicit answer', () => {
    const only = { ...stageRow, choices: [] };
    const picks = { [stageRow.path]: { discard: true as const } };
    expect(holdOf(plan({ mappings: [only] }), {}, picks)).toBeNull();
  });
});

describe('the confirm', () => {
  it('is held by blockers, a missing plan and an empty plan; a first deploy has no diff and may confirm', () => {
    expect(holdOf(null, {}, {})).toBe('no_plan');
    expect(holdOf(plan({ revision: null }), {}, {})).toBe('no_plan');
    const blocker = { id: '0', path: 'types.baum', message: 'x', type: 'baum' };
    expect(holdOf(plan({ blockers: [blocker], mappings: [] }), {}, {})).toBe('blockers');
    expect(holdOf(plan({ groups: [], mappings: [] }), {}, {})).toBe('no_changes');
    expect(holdOf(plan({ groups: [], mappings: [], first: true }), {}, {})).toBeNull();
    expect(holdOf(plan({ mappings: [] }), {}, {})).toBeNull();
  });

  it('has no request without a revision', () => {
    expect(requestOf(plan({ revision: null }), {}, {})).toBeNull();
  });
});
