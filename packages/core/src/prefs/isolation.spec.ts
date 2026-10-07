import { describe, expect, it } from 'vitest';
import { actorValue } from '../perms';
import { evalContext } from '../plan/scope';
import type { Actor, Key } from '../model';

// WP-612: preferences are never part of the rule context (owner answer "Preferences").
describe('prefs are not in the rule context', () => {
  it('the context of a run holds only actor and inputs, and the actor carries only id, kind and roles', () => {
    const actor: Actor = { id: 'mia', kind: 'participant', roles: ['melder' as Key] };
    const env = {
      inputs: {},
      overlay: {},
      config: { relations: new Map() },
      ports: { clock: { now: () => '2026-10-01T08:00:00.000Z' }, geo: {} },
    } as never;
    const ctx = evalContext(env, actor, new Map());
    expect([...ctx.vars.keys()].sort()).toEqual(['actor', 'inputs']);
    const value = actorValue(actor) as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(['id', 'kind', 'roles']);
  });
});
