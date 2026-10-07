import { describe, expect, it } from 'vitest';
import type { Actor, FeatureId, Key } from '@ueberblick/core';
import { build, golden } from '../../store/run/testkit';
import { resolveWriteTask } from './write-task';

const config = golden('musterstadt-plain');
const actor: Actor = { id: 'a', kind: 'admin', roles: ['verwaltung' as Key] };
const yes = (): boolean => true;
const f = 'f' as FeatureId;

describe('resolveWriteTask', () => {
  it('create: the unique available task that creates the type', () => {
    expect(
      resolveWriteTask(config, 'baumart', { kind: 'create', keys: ['name_de'] }, actor, undefined, yes),
    ).toEqual({ ok: true, task: 'baumart_anlegen' });
  });
  it('update: tasks on the type whose form covers every changed key', () => {
    expect(
      resolveWriteTask(
        config,
        'baum',
        { kind: 'update', feature: f, keys: ['geometrie'] },
        actor,
        undefined,
        yes,
      ),
    ).toEqual({ ok: true, task: 'verschieben' });
  });
  it('several candidates: refuse and list them, never the first', () => {
    const r = resolveWriteTask(
      config,
      'baum',
      { kind: 'update', feature: f, keys: ['befund'] },
      actor,
      undefined,
      yes,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.candidates.length).toBeGreaterThan(1);
  });
  it('none: refuse with an empty list; unavailable tasks are not candidates', () => {
    const r = resolveWriteTask(
      config,
      'baum',
      { kind: 'update', feature: f, keys: ['geometrie'] },
      actor,
      undefined,
      () => false,
    );
    expect(r).toMatchObject({ ok: false, candidates: [] });
  });
  it('the hint wins when it names a task of the type; else it is refused', () => {
    expect(
      resolveWriteTask(
        config,
        'baum',
        { kind: 'update', feature: f, keys: ['befund'] },
        actor,
        'befund_ergaenzen',
        yes,
      ),
    ).toEqual({ ok: true, task: 'befund_ergaenzen' });
    expect(
      resolveWriteTask(
        config,
        'baum',
        { kind: 'update', feature: f, keys: ['befund'] },
        actor,
        'erfassen',
        yes,
      ),
    ).toMatchObject({ ok: false });
    expect(
      resolveWriteTask(config, 'baum', { kind: 'update', feature: f, keys: ['befund'] }, actor, 'zzz', yes),
    ).toMatchObject({ ok: false });
  });
  it('delete has no task unless one only deletes', () => {
    expect(
      resolveWriteTask(config, 'baum', { kind: 'delete', feature: f }, actor, undefined, yes),
    ).toMatchObject({ ok: false, candidates: [] });
  });
  it('delete: the unique task of the type whose only effect is lifecycle deleted', () => {
    const file = structuredClone(config.file);
    file.tasks = {
      ...file.tasks,
      entfernen: { label: { de: 'Entfernen' }, on: 'baum', then: [{ lifecycle: 'deleted' }] },
    };
    const withDelete = build(file);
    expect(
      resolveWriteTask(withDelete, 'baum', { kind: 'delete', feature: f }, actor, undefined, yes),
    ).toEqual({ ok: true, task: 'entfernen' });
    // a task that also sets a value is not a delete task, and a hint must name one
    expect(
      resolveWriteTask(withDelete, 'baum', { kind: 'delete', feature: f }, actor, 'verschieben', yes),
    ).toMatchObject({ ok: false });
  });
});
