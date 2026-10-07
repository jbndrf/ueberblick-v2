// WP-041.2: derived edges inside a batch are recomputed against every candidate (Facts.near + overlay), and PlannedRun.rule.
import { describe, expect, it } from 'vitest';
import { createFold } from '../fold';
import { createGeo } from '../geo';
import type { Bbox } from '../geo';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { foldSchema } from '../schema/compile/views';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { Overlay } from './overlay';
import { addAuto } from './__fixtures__/auto';
import { inlineFile } from './__fixtures__/inline';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const maker = actor('participant', 'm', ['maker']);
const square = (x0: number, y0: number, x1: number, y1: number): Json => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ],
  ],
});
const POINT = { type: 'Point', coordinates: [1, 1] };
const OUTSIDE = { type: 'Point', coordinates: [50, 50] };

let n = 0;
const run = (task: string, input: Record<string, Json> = {}, featureId?: FeatureId): Run => ({
  id: rid(++n),
  task: task as Key,
  actor: maker,
  configVersion: 1,
  input,
  ...(featureId !== undefined ? { featureId } : {}),
});
const code = (r: PlanResult): string => (r.ok ? 'ok' : r.refusal.code);

/** An untouched zone [0,0]-[2,2] and an untouched item at [1,1] (its `zone` edge is stored). */
function setup(extra: (file: object) => void = () => undefined) {
  const file = inlineFile(3);
  extra(file);
  const config = build(file);
  const w = new World(config);
  w.add(fid(10), 'zone', { area: square(0, 0, 2, 2) });
  w.add(fid(1), 'item', { geom: POINT, label: 'a', n: 0 });
  return { config, w, perms: compilePerms(config), p: ports(w) };
}

describe('derived edges against untouched candidates', () => {
  it('a batch creating a feature inside an untouched zone yields the edge', () => {
    const { config, perms, p } = setup();
    const add = run('add', { geom: POINT, label: 'n' }, fid(9));
    expect(code(planApi.planFor([add, run('in_zone', {}, fid(9))], oneVersion(config, perms), p))).toBe('ok');
  });

  it('a batch creating a zone around an untouched item gives that item the edge', () => {
    const { config, w, perms, p } = setup();
    w.features.delete(fid(10));
    for (const k of [...w.edges.keys()]) w.edges.delete(k);
    expect(code(planApi.planFor([run('in_zone', {}, fid(1))], oneVersion(config, perms), p))).toBe(
      'bind_unresolved',
    );
    const zone = run('add_zone', { area: square(0, 0, 2, 2) });
    expect(code(planApi.planFor([zone, run('in_zone', {}, fid(1))], oneVersion(config, perms), p))).toBe(
      'ok',
    );
  });

  it('a batch moving a feature out of an untouched zone removes the edge', () => {
    const { config, perms, p } = setup();
    expect(code(planApi.planFor([run('in_zone', {}, fid(1))], oneVersion(config, perms), p))).toBe('ok');
    const moved = planApi.planFor(
      [run('move', { geom: OUTSIDE }, fid(1)), run('in_zone', {}, fid(1))],
      oneVersion(config, perms),
      p,
    );
    expect(code(moved)).toBe('bind_unresolved');
  });

  it('the facts stay untouched by the recomputation', () => {
    const { config, w, perms, p } = setup();
    const before = w.edgesFrom(fid(1)).length;
    planApi.planFor([run('move', { geom: OUTSIDE }, fid(1))], oneVersion(config, perms), p);
    expect(w.edgesFrom(fid(1)).length).toBe(before);
  });
});

describe('DIV-4: a created feature has its derived edges before its rules read them', () => {
  it('a rule on task.add that binds self.zone runs', () => {
    const { config, perms, p } = setup((file) => addAuto(file, 'in_zone', 'zoned', { after: 'add' }));
    const r = planApi.planFor([run('add', { geom: POINT, label: 'n' })], oneVersion(config, perms), p);
    expect(code(r)).toBe('ok');
    expect(r.ok && r.runs.map((x) => x.rule)).toContain('in_zone.zoned');
  });
});

describe('overlay features shadow Facts.near results', () => {
  it('a zone moved in the batch is judged by its planned area, not the stored one', () => {
    const { config, perms, p } = setup();
    const batch = [
      run('move_zone', { area: square(80, 80, 82, 82) }, fid(10)),
      run('add', { geom: POINT, label: 'n' }, fid(9)),
      run('in_zone', {}, fid(9)),
    ];
    expect(code(planApi.planFor(batch, oneVersion(config, perms), p))).toBe('bind_unresolved');
  });

  it('Overlay.near returns the planned feature once, and not by its old bbox', () => {
    const { config, w } = setup();
    const o = new Overlay(w, createFold(createGeo()), foldSchema(config, 1), config, ports(w));
    const ids = (b: Bbox) => [...o.near('zone' as Key, b)].map((f) => f.id);
    expect(ids([0, 0, 2, 2])).toEqual([fid(10)]);
    o.apply(rid(901), [{ featureId: fid(10), property: 'area', result: square(80, 80, 82, 82) }]);
    expect(ids([0, 0, 2, 2])).toEqual([]);
    expect(ids([81, 81, 81, 81])).toEqual([fid(10)]);
  });
});

describe('PlannedRun.rule', () => {
  it('is absent for user runs and names the rule for rule runs (two rules, one task)', () => {
    const { config, perms, p } = setup((file) => {
      addAuto(file, 'ping', 'first', { after: 'noop' });
      addAuto(file, 'ping', 'second', { after: 'noop' });
    });
    const r = planApi.planFor([run('noop', {}, fid(1))], oneVersion(config, perms), p);
    if (!r.ok) throw new Error(r.refusal.message);
    expect(r.runs.map((x) => x.run.task)).toEqual(['noop', 'ping', 'ping']);
    expect(r.runs.map((x) => x.rule)).toEqual([undefined, 'ping.first', 'ping.second']);
    expect('rule' in (r.runs[0] ?? {})).toBe(false);
  });
});
