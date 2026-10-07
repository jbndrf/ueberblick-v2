// WP-342: the built-in `$seed` task. Creates a feature with stage and geometry, validates values, system actor only.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { SEED_TASK } from '../registry';
import { createPlan, oneVersion } from './index';
import { World, actor, anna, fid, golden, ports, rid } from './__fixtures__/world';

const SYSTEM: Actor = actor('system', 'system');
const planApi = createPlan(formApi);
const config = golden('musterstadt-baeume');
const perms = compilePerms(config);
const point = { type: 'Point', coordinates: [10.45, 51.16] };

const seed = (input: Record<string, Json>, who: Actor = SYSTEM, featureId = fid(7)): Run => ({
  id: rid(1),
  task: SEED_TASK as Key,
  actor: who,
  configVersion: 1,
  featureId,
  input,
});
const plan = (run: Run) => planApi.planFor([run], oneVersion(config, perms), ports(new World(config)));

describe('$seed', () => {
  it('creates a feature with a later stage and a geometry in one run', () => {
    const r = plan(seed({ type: 'baum', values: { stage: 'massnahme', geometrie: point, befund: 'x' } }));
    if (!r.ok) throw new Error(r.refusal.message);
    const [planned] = r.runs;
    expect(planned?.created).toEqual([fid(7)]);
    const by = Object.fromEntries((planned?.observations ?? []).map((o) => [o.property, o.result]));
    expect(by).toMatchObject({
      $type: 'baum',
      stage: 'massnahme',
      geometrie: point,
      kontrolle_faellig: false,
    });
  });

  it('a missing stage gets the process start', () => {
    const r = plan(seed({ type: 'baum', values: { geometrie: point } }));
    if (!r.ok) throw new Error('refused');
    expect(r.runs[0]?.observations.find((o) => o.property === 'stage')?.result).toBe('erfasst');
  });

  it('seeds a type no task creates', () => {
    expect(plan(seed({ type: 'massnahme', values: { art: 'faellen' } })).ok).toBe(true);
  });

  it.each([
    ['a non-option stage', { type: 'baum', values: { stage: 'nope' } }],
    ['an unknown property', { type: 'baum', values: { gibtsnicht: 1 } }],
    ['a wrong value type', { type: 'baum', values: { hoehe_m: 'hoch' } }],
    ['an unknown type', { type: 'nope', values: {} }],
    ['missing values', { type: 'baum' }],
  ])('refuses %s', (_n, input) => {
    const r = plan(seed(input as Record<string, Json>));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('invalid_input');
  });

  it('only the system actor may run it', () => {
    for (const who of [anna, actor('import', 'imp'), actor('admin', 'root')]) {
      const r = plan(seed({ type: 'baum', values: {} }, who));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal.code).toBe('not_permitted');
    }
  });
});
