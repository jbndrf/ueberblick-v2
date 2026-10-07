// WP-557: `plan(..., { trace: true })` explains every rule considered, from the same code path as planning.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { RULE_TRACE_REASONS } from '../registry/rule-trace';
import { createPlan, oneVersion } from './index';
import type { PlanResult, RuleTraceEntry } from './contract';
import { inline } from './__fixtures__/inline';
import { World, actor, fid, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const maker = actor('participant', 'm', ['maker']);

let n = 100;
const run = (task: string, who: Actor, input: Record<string, Json> = {}, featureId?: FeatureId): Run => ({
  id: rid(++n),
  task: task as Key,
  actor: who,
  configVersion: 1,
  input,
  ...(featureId !== undefined ? { featureId } : {}),
});

function world(limit = 3) {
  const config = inline(limit);
  const w = new World(config);
  w.add(fid(1), 'item', { geom: { type: 'Point', coordinates: [1, 1] }, label: 'a', n: 0 });
  return { config, perms: compilePerms(config), p: ports(w) };
}
const traceOf = (r: PlanResult): readonly RuleTraceEntry[] => r.trace ?? [];
const of = (r: PlanResult, rule: string) => traceOf(r).filter((e) => e.rule === rule);

describe('rule trace', () => {
  it('is absent unless asked for, and the outcome is identical either way', () => {
    const { config, perms, p } = world();
    const off = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), p);
    expect(off.trace).toBeUndefined();
    const on = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), p, {
      trace: true,
    });
    expect(on.trace).toBeDefined();
    expect(on.ok).toBe(off.ok);
    if (on.ok && off.ok)
      expect(on.runs.map((r) => r.observations)).toEqual(off.runs.map((r) => r.observations));
  });

  it('a 3-step chain: fired, fired, then when_false with the explanation', () => {
    const { config, perms, p } = world(3);
    const r = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), p, {
      trace: true,
    });
    expect(r.ok).toBe(true);
    const again = of(r, 'bump.again');
    expect(again.map((e) => e.reason)).toEqual(['fired', 'fired', 'when_false']);
    expect(again.map((e) => e.depth)).toEqual([0, 1, 2]);
    if (!r.ok) return;
    // each fired entry names the rule run it planned; trigger.causedBy links the chain
    expect(again[0]?.run).toBe(r.runs[1]?.run.id);
    expect(again[1]?.run).toBe(r.runs[2]?.run.id);
    expect(again[0]?.trigger).toEqual({ kind: 'run', causedBy: r.runs[0]?.run.id });
    expect(again[1]?.trigger).toEqual({ kind: 'run', causedBy: r.runs[1]?.run.id });
    expect(again[2]?.trigger).toEqual({ kind: 'run', causedBy: r.runs[2]?.run.id });
    expect(again[2]?.explanation?.value).toBe(false);
    expect(again[2]?.explanation?.text).toContain('self.n');
    expect(again[2]?.subject).toBe(fid(1));
  });

  it('trigger_not_matched names the rules whose trigger no change of the run matches', () => {
    const { config, perms, p } = world();
    const r = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), p, {
      trace: true,
    });
    expect(of(r, 'needs_note.poke_rule')[0]?.reason).toBe('trigger_not_matched');
    expect(of(r, 'log_change.on_label')[0]?.reason).toBe('trigger_not_matched');
    expect(of(r, 'needs_note.poke_rule')[0]?.depth).toBe(0);
  });

  it('depth_exceeded: the entry carries the refusal and the trace of a refused batch is returned', () => {
    const { config, perms, p } = world(5);
    const tight = { ...p, limits: { ruleDepth: 3 } };
    const r = planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), tight, {
      trace: true,
    });
    expect(r.ok).toBe(false);
    const last = of(r, 'bump.again').at(-1);
    expect(last?.reason).toBe('depth_exceeded');
    expect(last?.refusal?.code).toBe('depth_exceeded');
    // the rules above the failing one are refused by their child, with the same code
    expect(of(r, 'bump.again').map((e) => e.reason)).toEqual([
      'refused',
      'refused',
      'refused',
      'depth_exceeded',
    ]);
    expect(of(r, 'bump.again')[0]?.refusal?.code).toBe('depth_exceeded');
  });

  it('refused: a fired rule whose run is refused ends the trace with the refusal', () => {
    const { config, perms, p } = world();
    const r = planApi.planFor([run('poke', maker, {}, fid(1))], oneVersion(config, perms), p, {
      trace: true,
    });
    expect(r.ok).toBe(false);
    const e = of(r, 'needs_note.poke_rule');
    expect(e).toHaveLength(1);
    expect(e[0]?.reason).toBe('refused');
    expect(e[0]?.refusal?.code).toBe('required_missing');
  });

  it('a property-change trigger fires and is traced', () => {
    const { config, perms, p } = world();
    const s = planApi.planFor(
      [run('add', maker, { geom: { type: 'Point', coordinates: [2, 2] }, label: 'x' })],
      oneVersion(config, perms),
      p,
      { trace: true },
    );
    expect(of(s, 'log_change.on_label').map((e) => e.reason)).toContain('fired');
  });

  it('every reason in the registry is used by the entries (no inline codes)', () => {
    const { config, perms, p } = world(5);
    const all = [
      planApi.planFor([run('bump', maker, {}, fid(1))], oneVersion(config, perms), p, { trace: true }),
      planApi.planFor([run('poke', maker, {}, fid(1))], oneVersion(config, perms), p, { trace: true }),
    ].flatMap(traceOf);
    for (const e of all) expect(RULE_TRACE_REASONS.has(e.reason)).toBe(true);
  });
});
