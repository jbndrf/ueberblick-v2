// WP-311: a participant can never write `$version`; rules read `self.$version`; redaction leaves it alone.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { SYSTEM_FIELDS } from '../registry';
import { planRedaction } from './redact';
import { createPlan, oneVersion } from './index';
import { World, actor, build, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'pin', version: '1.0.0' },
  roles: { worker: { label: 'Worker' } },
  types: {
    fall: {
      label: 'Fall',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { note: { type: 'text' } },
    },
  },
  tasks: {
    add: { label: 'Add', on: '$none', creates: 'fall', form: { note: {} } },
    pinned: {
      label: 'Pinned',
      on: 'fall',
      when: 'self.$version == 2',
      then: [{ set: { note: "'pinned'" } }],
    },
    floating: {
      label: 'Floating',
      on: 'fall',
      when: 'self.$version == null',
      then: [{ set: { note: "'floating'" } }],
    },
  },
};
const anna = actor('participant', 'anna', ['worker']);
let n = 0;
function setup() {
  const config = build(file);
  const w = new World(config);
  const perms = compilePerms(config);
  const p = ports(w);
  const go = (task: string, feature?: FeatureId, input: Record<string, string | number | null> = {}) => {
    const r: Run = {
      id: rid(++n),
      task: task as Key,
      actor: anna,
      configVersion: 1,
      input,
      clientTime: new Date(Date.UTC(2026, 4, 1, 8, 0, n)).toISOString(),
      ...(feature === undefined ? {} : { featureId: feature }),
    };
    const res = api.planFor([r], oneVersion(config, perms), p);
    if (res.ok) for (const pr of res.runs) w.append(pr.run.id, pr.observations, pr.run.actor.id);
    return res;
  };
  return { w, go };
}

describe('$version and participants', () => {
  it('a run input naming $version is refused not_permitted, nothing is written', () => {
    const s = setup();
    for (const input of [
      { note: 'x', $version: 2 },
      { note: 'x', $version: null },
    ]) {
      const r = s.go('add', undefined, input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal.code).toBe('not_permitted');
    }
    const created = s.go('add', undefined, { note: 'x' });
    if (!created.ok) throw new Error('refused');
    expect(created.runs.flatMap((x) => x.observations).some((o) => o.property === '$version')).toBe(false);
  });

  it('a create writes no pin: the feature floats', () => {
    const s = setup();
    const r = s.go('add', undefined, { note: 'x' });
    if (!r.ok) throw new Error('refused');
    expect(s.w.feature(r.runs[0]?.created[0] as FeatureId)?.pinnedVersion).toBeUndefined();
  });
});

describe('self.$version in rules', () => {
  it('is registered as an integer system field on the pinned_version column', () => {
    expect(SYSTEM_FIELDS.get('version')).toMatchObject({
      state: 'pinnedVersion',
      column: 'pinned_version',
      type: 'int',
    });
  });

  it('reads the pin: null while floating, the number once a system run pinned it', () => {
    const s = setup();
    const r = s.go('add', undefined, { note: 'x' });
    if (!r.ok) throw new Error('refused');
    const id = r.runs[0]?.created[0] as FeatureId;
    expect(s.go('pinned', id).ok).toBe(false);
    expect(s.go('floating', id).ok).toBe(true);
    s.w.append(rid(++n), [{ featureId: id, property: '$version', result: 2 }], 'system');
    expect(s.go('floating', id).ok).toBe(false);
    expect(s.go('pinned', id).ok).toBe(true);
    expect(s.w.feature(id)?.properties['note']).toBe('pinned');
  });
});

describe('redaction', () => {
  it('leaves $version alone: it is reserved and cannot be a redaction pair', () => {
    expect(() => planRedaction({ pairs: [{ featureId: 'f' as FeatureId, property: '$version' }] })).toThrow(
      /reserved/,
    );
    const ok = planRedaction({ pairs: [{ featureId: 'f' as FeatureId, property: 'note' }] });
    expect(ok.observations.map((o) => o.property)).toEqual(['note']);
  });
});
