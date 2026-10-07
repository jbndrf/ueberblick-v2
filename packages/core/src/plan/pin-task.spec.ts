// WP-317 (A-029): the built-in `$pin` task writes the reserved key `$version`; system actor only; idempotent.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { PIN_TASK } from '../registry';
import { SYSTEM_TASKS } from '../registry/admin';
import { createPlan, oneVersion } from './index';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const file = {
  schema: 'ueberblick/1',
  template: { key: 'pin', version: '1.0.0' },
  roles: { maker: { label: 'Maker' } },
  types: {
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { notiz: { type: 'text' } },
    },
  },
};

const planApi = createPlan(formApi);
const SYSTEM = actor('system', 'system');
let n = 0;

function setup() {
  const config = build(file);
  const world = new World(config);
  const id = world.add(fid(1), 'baum', { notiz: 'x' });
  const go = (input: Record<string, Json>, who = SYSTEM, feature: typeof id | undefined = id) => {
    const run: Run = {
      id: rid(++n),
      task: PIN_TASK as Key,
      actor: who,
      configVersion: 1,
      input,
      ...(feature === undefined ? {} : { featureId: feature }),
    };
    const r = planApi.planFor([run], oneVersion(config, compilePerms(config)), ports(world));
    if (r.ok) {
      const obs = r.runs.flatMap((p) => p.observations);
      if (obs.length > 0) world.append(rid(++n), obs);
    }
    return r;
  };
  return { world, id, go };
}

describe('$pin', () => {
  it('is a registry system task', () => {
    expect(SYSTEM_TASKS.entries.some((e) => e.key === PIN_TASK)).toBe(true);
  });

  it('pins a floating feature, is idempotent, and unpins with null', () => {
    const s = setup();
    const r = s.go({ version: 3 });
    expect(r.ok && r.runs[0]?.observations).toEqual([{ featureId: s.id, property: '$version', result: 3 }]);
    expect(s.world.feature(s.id)?.pinnedVersion).toBe(3);
    const again = s.go({ version: 3 });
    expect(again.ok && again.runs[0]?.observations).toEqual([]);
    const unpin = s.go({ version: null });
    expect(unpin.ok && unpin.runs[0]?.observations).toHaveLength(1);
    expect(s.world.feature(s.id)?.pinnedVersion).toBeUndefined();
    const unpinAgain = s.go({ version: null });
    expect(unpinAgain.ok && unpinAgain.runs[0]?.observations).toEqual([]);
  });

  it('refuses a participant, an admin, a missing feature and a bad version', () => {
    const s = setup();
    for (const who of [actor('participant', 'anna', ['maker']), actor('admin', 'root')]) {
      const r = s.go({ version: 2 }, who);
      expect(!r.ok && r.refusal.code).toBe('not_permitted');
    }
    const missing = s.go({ version: 2 }, SYSTEM, fid(99));
    expect(!missing.ok && missing.refusal.code).toBe('unknown_feature');
    for (const version of [0, 1.5, 'x', -2]) {
      const r = s.go({ version });
      expect(!r.ok && r.refusal.code).toBe('invalid_input');
    }
    expect(s.world.feature(s.id)?.pinnedVersion).toBeUndefined();
  });
});
