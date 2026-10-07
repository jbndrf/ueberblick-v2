// WP-041: rule chains and depth, change triggers, create permission, required properties, layered derived edges.
import { describe, expect, it } from 'vitest';
import { createFold } from '../fold';
import { createGeo } from '../geo';
import { formApi } from '../form';
import type { Actor, FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { foldSchema } from '../schema/compile/views';
import { createPlan, oneVersion, PLAN_MAX_RULE_DEPTH } from './index';
import type { PlanResult } from './contract';
import { Overlay } from './overlay';
import { INLINE_COVERED, inline } from './__fixtures__/inline';
import { World, actor, fid, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const maker = actor('participant', 'm', ['maker']);
const viewer = actor('participant', 'v', ['viewer']);

let n = 0;
const run = (task: string, who: Actor, input: Record<string, Json> = {}, featureId?: FeatureId): Run => ({
  id: rid(++n),
  task: task as Key,
  actor: who,
  configVersion: 1,
  input,
  ...(featureId !== undefined ? { featureId } : {}),
});
const POINT = { type: 'Point', coordinates: [1, 1] };

function world(limit = 3) {
  const config = inline(limit);
  const w = new World(config);
  w.add(fid(1), 'item', { geom: POINT, label: 'a', n: 0 });
  return { config, w, perms: compilePerms(config), p: ports(w) };
}
const code = (r: PlanResult): string => (r.ok ? 'ok' : r.refusal.code);

describe('create permission and required properties', () => {
  it('a participant without the create role is refused (not_permitted)', () => {
    const { config, perms, p } = world();
    expect(
      code(planApi.planFor([run('add', viewer, { geom: POINT, label: 'x' })], oneVersion(config, perms), p)),
    ).toBe('not_permitted');
    expect(
      code(planApi.planFor([run('add', maker, { geom: POINT, label: 'x' })], oneVersion(config, perms), p)),
    ).toBe('ok');
    // an import or system actor is not bound by the allowlist
    expect(
      code(
        planApi.planFor(
          [run('add', actor('import', 'csv'), { geom: POINT, label: 'x' })],
          oneVersion(config, perms),
          p,
        ),
      ),
    ).toBe('ok');
  });

  it('a new feature needs its required properties: geometry_required, required_missing', () => {
    const { config, perms, p } = world();
    const g = planApi.planFor([run('add', maker, { label: 'x' })], oneVersion(config, perms), p);
    expect(code(g)).toBe('geometry_required');
    expect(code(planApi.planFor([run('add', maker, { geom: POINT })], oneVersion(config, perms), p))).toBe(
      'required_missing',
    );
  });

  it('defaults are applied on creation', () => {
    const { config, perms, p } = world();
    const r = planApi.planFor([run('add', maker, { geom: POINT, label: 'x' })], oneVersion(config, perms), p);
    expect(r.ok && r.runs[0]?.observations.map((o) => o.property)).toContain('n');
  });

  it('a participant who cannot see the feature is refused by plan and by available alike (permissions.see)', () => {
    const { config, w, perms, p } = world();
    w.add(fid(20), 'secret', { note: 'x' });
    const input = { note: 'y' };
    const r = planApi.planFor([run('touch_secret', viewer, input, fid(20))], oneVersion(config, perms), p);
    expect(r.ok).toBe(false);
    const a = planApi.availableFor(
      'touch_secret' as Key,
      { feature: fid(20) },
      viewer,
      oneVersion(config, perms),
      p,
    );
    expect(a.ok).toBe(false);
    if (r.ok || a.ok) throw new Error('both must be refused');
    expect(r.refusal.code).toBe('not_permitted');
    expect(r.refusal.path).toBe('permissions.see');
    expect(a.refusal).toEqual(r.refusal);
    expect(
      code(planApi.planFor([run('touch_secret', maker, input, fid(20))], oneVersion(config, perms), p)),
    ).toBe('ok');
  });

  it('role allowlists bind participants only: write is refused for a viewer, accepted for maker, import and admin; the system runs only tasks with auto', () => {
    const { config, w, perms, p } = world();
    w.add(fid(21), 'guarded', { note: 'x' });
    const go = (who: Actor, input: Record<string, Json> = { note: 'y' }) =>
      code(planApi.planFor([run('edit_guarded', who, input, fid(21))], oneVersion(config, perms), p));
    expect(go(viewer)).toBe('not_permitted');
    expect(go(maker)).toBe('ok');
    // the system runs only tasks that carry `auto`: edit_guarded has none
    expect(go(actor('system', 'system'), {})).toBe('not_permitted');
    expect(go(actor('import', 'csv'))).toBe('ok');
    expect(go(actor('admin', 'root'))).toBe('ok');
  });

  it('covers the codes plan.spec leaves to this file', () => {
    expect([...INLINE_COVERED].sort()).toEqual([
      'depth_exceeded',
      'geometry_required',
      'not_permitted',
      'quota_exceeded',
      'too_many_targets',
    ]);
  });
});

describe('rule chains and depth', () => {
  it('a chain within the limit runs depth-first, each run caused by the one before', () => {
    const { config, perms, p } = world(5);
    const r = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), p);
    if (!r.ok) throw new Error(r.refusal.message);
    expect(r.runs).toHaveLength(5); // the submitted run plus four rule runs (n: 1 -> 5)
    r.runs.slice(1).forEach((pr, i) => expect(pr.run.causedBy).toBe(r.runs[i]?.run.id));
    expect(r.runs.at(-1)?.observations).toContainEqual(expect.objectContaining({ property: 'n', result: 5 }));
  });

  it(`exactly ${PLAN_MAX_RULE_DEPTH} nested rule runs are allowed, one more is depth_exceeded and refuses the triggering run`, () => {
    const ok = world(PLAN_MAX_RULE_DEPTH + 1); // the limit is n < limit: limit - 1 rule runs
    const r = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(ok.config, ok.perms), ok.p);
    expect(r.ok && r.runs).toHaveLength(PLAN_MAX_RULE_DEPTH + 1);
    const deep = world(PLAN_MAX_RULE_DEPTH + 2);
    const bad = run('bump', maker, {}, fid(1));
    const res = planApi.planFor([bad], oneVersion(deep.config, deep.perms), deep.p);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.refusal.code).toBe('depth_exceeded');
      expect(res.runId).toBe(bad.id);
    }
  });

  it('ports.limits.ruleDepth decides the depth, not the platform default (DIV-5)', () => {
    const { config, perms, p } = world(5); // four rule runs
    const tight = { ...p, limits: { ruleDepth: 3 } };
    const r = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), tight);
    expect(!r.ok && r.refusal.code).toBe('depth_exceeded');
    const roomy = { ...p, limits: { ruleDepth: 4 } };
    expect(planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), roomy).ok).toBe(true);
  });

  it('property-change triggers fire a rule with the changed feature as self', () => {
    const { config, perms, p } = world();
    const r = planApi.planFor(
      [run('add', maker, { geom: POINT, label: 'hallo' })],
      oneVersion(config, perms),
      p,
    );
    if (!r.ok) throw new Error(r.refusal.message);
    const rule = r.runs[1];
    expect(rule?.run.task).toBe('log_change');
    const flat = (rule?.observations ?? []).map((o) => [o.property, o.result]);
    expect(flat).toContainEqual(['note', 'hallo']);
    expect(flat).toContainEqual(['item', r.runs[0]?.created[0]]);
  });

  it('a rule run that is refused refuses the submitted run, with the rule named', () => {
    const { config, perms, p } = world();
    const poke = run('poke', maker, {}, fid(1));
    const r = planApi.planFor([poke], oneVersion(config, perms), p);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.runId).toBe(poke.id);
      expect(r.refusal.code).toBe('required_missing');
      expect(r.refusal.message).toContain("rule 'needs_note.poke_rule'");
    }
  });
});

describe('availability = the checks plan runs first', () => {
  it('`actor` in `when` is bound with actorValue: the same on device, server and SQL', () => {
    const { config, perms, p } = world();
    expect(
      planApi.availableFor(
        'only_x' as Key,
        { feature: fid(1) },
        actor('participant', 'x', ['maker']),
        oneVersion(config, perms),
        p,
      ).ok,
    ).toBe(true);
    const no = planApi.availableFor(
      'only_x' as Key,
      { feature: fid(1) },
      actor('participant', 'y', ['maker']),
      oneVersion(config, perms),
      p,
    );
    expect(no.ok).toBe(false);
    // plan refuses with exactly the refusal available() reports
    const r = planApi.planFor(
      [run('only_x', actor('participant', 'y', ['maker']), {}, fid(1))],
      oneVersion(config, perms),
      p,
    );
    if (r.ok || no.ok) throw new Error('both must be refused');
    expect(r.refusal).toEqual(no.refusal);
  });
});

describe('the overlay layers derived edges over the facts', () => {
  const zoneArea = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  };
  it('a task that binds a derived relation sees a zone created earlier in the same batch', () => {
    const { config, perms, p } = world();
    const alone = planApi.planFor([run('in_zone', maker, {}, fid(1))], oneVersion(config, perms), p);
    expect(code(alone)).toBe('bind_unresolved');
    const zone = run('add_zone', maker, { area: zoneArea });
    const inBatch = planApi.planFor([zone, run('in_zone', maker, {}, fid(1))], oneVersion(config, perms), p);
    // item 1 lies at [1,1] inside the new zone: Facts.near finds it although the batch never touched it
    expect(code(inBatch)).toBe('ok');
    // a feature created in the same batch gets its derived edge too
    const both = planApi.planFor(
      [zone, run('add', maker, { geom: POINT, label: 'n' }, fid(9)), run('in_zone', maker, {}, fid(9))],
      oneVersion(config, perms),
      p,
    );
    expect(code(both)).toBe('ok');
  });

  it('a derived relation with a condition is honoured, and a change of an input property recomputes it', () => {
    const { config, perms, p } = world();
    const zone = run('add_zone', maker, { area: zoneArea, kind: 'a' });
    const item = (kind: string) => run('add', maker, { geom: POINT, label: 'n', kind }, fid(9));
    const same = run('in_same', maker, {}, fid(9));
    expect(code(planApi.planFor([zone, item('a'), same], oneVersion(config, perms), p))).toBe('ok');
    expect(code(planApi.planFor([zone, item('b'), same], oneVersion(config, perms), p))).toBe(
      'bind_unresolved',
    );
    // kind is an input of the condition: changing it (no geometry change) adds the edge
    const fix = run('set_kind', maker, { kind: 'a' }, fid(9));
    expect(code(planApi.planFor([zone, item('b'), fix, same], oneVersion(config, perms), p))).toBe('ok');
    // and changing it away removes it again
    const away = run('set_kind', maker, { kind: 'c' }, fid(9));
    expect(code(planApi.planFor([zone, item('a'), away, same], oneVersion(config, perms), p))).toBe(
      'bind_unresolved',
    );
  });

  it('Overlay.apply: edges and history layer over facts and never change them', () => {
    const { config, w } = world();
    const o = new Overlay(w, createFold(createGeo()), foldSchema(config, 1), config, ports(w));
    const before = w.edgesFrom(fid(1)).length;
    o.apply(rid(900), [
      { featureId: fid(2), property: '$type', result: 'log' },
      { featureId: fid(2), property: 'item', result: fid(1) },
      { featureId: fid(2), property: 'note', result: 'n1' },
    ]);
    expect(o.edgesFrom(fid(2), 'item' as Key).map((e) => e.to)).toEqual([fid(1)]);
    expect(o.edgesTo(fid(1)).map((e) => e.from)).toEqual([fid(2)]);
    expect(o.history(fid(2), 'note', 5).map((h) => h.result)).toEqual(['n1']);
    expect(w.feature(fid(2))).toBeUndefined();
    expect(w.edgesFrom(fid(1)).length).toBe(before);
  });
});
