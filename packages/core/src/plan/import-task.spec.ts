// WP-363: the built-in `$import` and `$lifecycle` tasks.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { IMPORT_TASK, LIFECYCLE_TASK } from '../registry';
import { createPlan, oneVersion } from './index';
import { World, actor, anna, fid, golden, ports, rid } from './__fixtures__/world';

const IMPORTER: Actor = actor('import', 'imp', ['verwaltung']);
const planApi = createPlan(formApi);
const config = golden('musterstadt-baeume');
const perms = compilePerms(config);
const point = { type: 'Point', coordinates: [10.45, 51.16] };
const plan = (run: Run, world = new World(config)) =>
  planApi.planFor([run], oneVersion(config, perms), ports(world));

const imp = (input: Record<string, Json>, who: Actor = IMPORTER): Run => ({
  id: rid(1),
  task: IMPORT_TASK as Key,
  actor: who,
  configVersion: 1,
  featureId: fid(7),
  input,
});
const base = { task: 'erfassen', values: { geometrie: point, vitalitaet: 'v2' } };
const by = (r: ReturnType<typeof plan>) => {
  if (!r.ok) throw new Error(r.refusal.message);
  return Object.fromEntries((r.runs[0]?.observations ?? []).map((o) => [o.property, o.result]));
};

describe('$import', () => {
  it('without constants it plans the creating task: process start and then steps apply', () => {
    const o = by(plan(imp({ ...base, constants: {} })));
    expect(o).toMatchObject({ $type: 'baum', vitalitaet: 'v2', stage: 'erfasst' });
    expect(o['faellig_am']).toBeDefined();
  });

  it('a constant overrides the start stage and keeps the stored run as the $import run', () => {
    const r = plan(imp({ ...base, constants: { stage: 'massnahme' } }));
    expect(by(r)['stage']).toBe('massnahme');
    if (r.ok) {
      expect(r.runs[0]?.run.task).toBe(IMPORT_TASK);
      expect(r.runs[0]?.created).toEqual([fid(7)]);
    }
  });

  it.each([
    ['a non-option stage', { stage: 'nope' }],
    ['an unknown property', { gibtsnicht: 1 }],
    ['a system key', { $lifecycle: 'deleted' }],
    ['a wrong value type', { hoehe_m: 'hoch' }],
  ])('refuses %s', (_n, constants) => {
    const r = plan(imp({ ...base, constants }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('invalid_input');
  });

  it('a refusal of the creating task is passed on', () => {
    const r = plan(imp({ task: 'erfassen', values: { geometrie: point }, constants: {} }));
    expect(r.ok).toBe(false);
  });

  it('only the import actor may run it', () => {
    const r = plan(imp({ ...base, constants: {} }, anna));
    expect(!r.ok && r.refusal.code).toBe('not_permitted');
  });

  it('a task that creates nothing is refused', () => {
    const r = plan(imp({ task: 'kontrolle', values: {}, constants: {} }));
    expect(!r.ok && r.refusal.code).toBe('invalid_input');
  });
});

describe('$lifecycle', () => {
  const life = (state: Json, who: Actor = IMPORTER, id = fid(7)): Run => ({
    id: rid(2),
    task: LIFECYCLE_TASK as Key,
    actor: who,
    configVersion: 1,
    featureId: id,
    input: { state },
  });
  const world = () => {
    const w = new World(config);
    w.add(fid(7), 'baum', {});
    return w;
  };

  it('refuses a bad state, an unknown feature and a participant', () => {
    expect(plan(life('nope')).ok).toBe(false);
    const missing = plan(life('deleted'));
    expect(!missing.ok && missing.refusal.code).toBe('unknown_feature');
    const who = plan(life('deleted', anna));
    expect(!who.ok && who.refusal.code).toBe('not_permitted');
  });

  it('writes the reserved key for an existing feature', () => {
    const w = world();
    const r = plan(life('deleted'), w);
    if (!r.ok) throw new Error(r.refusal.message);
    expect(r.runs[0]?.observations).toEqual([
      { featureId: fid(7), property: '$lifecycle', result: 'deleted' },
    ]);
  });
});
