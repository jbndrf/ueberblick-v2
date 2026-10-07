// WP-392: the plan refuses a select answer outside the options the form entry's choice_filter offers (the
// device and the server run the same core.form evaluation, R1).
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const file = {
  schema: 'ueberblick/1',
  template: { key: 'choice', version: '1.0.0' },
  roles: { r: { label: 'R' } },
  types: {
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        gruppe: { type: 'select', options: { laub: 'Laub', nadel: 'Nadel' } },
        art: { type: 'select', options: { eiche: 'Eiche', linde: 'Linde', kiefer: 'Kiefer' } },
      },
    },
  },
  tasks: {
    wahl: {
      label: 'Wahl',
      on: 'baum',
      form: {
        gruppe: {},
        art: { choice_filter: "form.gruppe == 'laub' ? option != 'kiefer' : option == 'kiefer'" },
      },
    },
  },
};
const F: FeatureId = fid(7);
let n = 0;
function go(input: Record<string, Json>): PlanResult {
  const config = build(file);
  const w = new World(config);
  w.add(F, 'baum', {});
  const r: Run = {
    id: rid(++n),
    task: 'wahl' as Key,
    actor: actor('participant', 'u', ['r']),
    configVersion: 1,
    input,
    featureId: F,
  };
  return api.planFor([r], oneVersion(config, compilePerms(config)), ports(w));
}

describe('choice_filter in the plan', () => {
  it('accepts an offered answer', () => {
    expect(go({ gruppe: 'laub', art: 'linde' }).ok).toBe(true);
  });

  it('refuses an answer outside the offered options with invalid_input', () => {
    const r = go({ gruppe: 'nadel', art: 'linde' });
    expect(!r.ok && r.refusal.code).toBe('invalid_input');
    expect(!r.ok && r.refusal.path).toBe('form.art');
  });

  it('property: accepted exactly when the answer is offered', () => {
    for (const g of ['laub', 'nadel'])
      for (const a of ['eiche', 'linde', 'kiefer']) {
        const offered = g === 'laub' ? a !== 'kiefer' : a === 'kiefer';
        expect(go({ gruppe: g, art: a }).ok).toBe(offered);
      }
  });
});
