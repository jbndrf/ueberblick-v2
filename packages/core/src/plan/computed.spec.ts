// WP-312: plan recomputes `computed` properties in the same run, in dependency order, only when an input changed;
// `$recompute` (system only) brings one feature up to date. The same planner serves the device and the server.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { FeatureId, Json, Key, Observation, Run } from '../model';
import { compilePerms } from '../perms';
import { computedFile } from '../schema/compile/__fixtures__/computed';
import type { PlanResult } from './contract';
import { createPlan, oneVersion } from './index';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const maker = actor('participant', 'm', ['maker']);
const system = actor('system', 'system');

function setup() {
  const config = build(computedFile());
  const w = new World(config);
  return { config, w, perms: compilePerms(config), p: ports(w) };
}
type Setup = ReturnType<typeof setup>;

let n = 0;
const run = (task: string, input: Record<string, Json>, featureId?: FeatureId, by = maker): Run => ({
  id: rid(++n),
  task: task as Key,
  actor: by,
  configVersion: 1,
  input,
  ...(featureId !== undefined ? { featureId } : {}),
});

/** Plans one run and commits its observations to the world, like the store does after acceptance. */
function submit(s: Setup, r: Run): PlanResult {
  const res = planApi.planFor([r], oneVersion(s.config, s.perms), s.p);
  if (res.ok) for (const pr of res.runs) s.w.append(pr.run.id, pr.observations);
  return res;
}
const observed = (r: PlanResult): readonly Observation[] =>
  r.ok ? r.runs.flatMap((x) => x.observations) : [];
const written = (r: PlanResult): string[] => observed(r).map((o) => o.property);
const value = (s: Setup, id: FeatureId, key: string): Json | undefined => s.w.feature(id)?.properties[key];

const ID = fid(1);
const create = (s: Setup, input: Record<string, Json>): PlanResult => submit(s, run('create', input, ID));

describe('plan: computed properties', () => {
  it('a run whose input carries a computed key is refused (WP-804)', () => {
    const s = setup();
    const r = create(s, { width: 5, height: 4, area: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('invalid_input');
  });

  it('a create computes every computed property in dependency order, in the same run', () => {
    const s = setup();
    const r = create(s, { width: 5, height: 4, label: 'a' });
    expect(r.ok).toBe(true);
    const runs = r.ok ? r.runs : [];
    expect(runs).toHaveLength(1);
    const props = written(r);
    // size_class is declared first but reads area: area comes first.
    expect(props.indexOf('area')).toBeGreaterThan(-1);
    expect(props.indexOf('area')).toBeLessThan(props.indexOf('size_class'));
    expect(value(s, ID, 'area')).toBe(20);
    expect(value(s, ID, 'size_class')).toBe('small');
  });

  it('changing an input appends the computed observations; computed-on-computed follows', () => {
    const s = setup();
    create(s, { width: 5, height: 4, label: 'a' });
    const r = submit(s, run('edit', { width: 30 }, ID));
    expect(written(r)).toEqual(['width', 'area', 'size_class']);
    expect(value(s, ID, 'area')).toBe(120);
    expect(value(s, ID, 'size_class')).toBe('large');
  });

  it('a change that leaves a computed value as it is writes nothing for it', () => {
    const s = setup();
    create(s, { width: 5, height: 4, label: 'a' });
    // width 10 / height 2 keeps area 20, so size_class is not even touched.
    const r = submit(s, run('edit', { width: 10, height: 2 }, ID));
    expect(written(r)).toEqual(['width', 'height']);
  });

  it('changing an unrelated property does not append a computed observation', () => {
    const s = setup();
    create(s, { width: 5, height: 4, label: 'a' });
    expect(written(submit(s, run('edit', { label: 'b' }, ID)))).toEqual(['label']);
  });

  it('a participant without write permission on the computed property still triggers it', () => {
    const s = setup();
    create(s, { width: 5, height: 4 });
    const r = submit(s, run('edit', { height: 40 }, ID));
    expect(r.ok).toBe(true);
    expect(value(s, ID, 'area')).toBe(200);
  });

  it('an input that cannot be evaluated clears the computed value instead of leaving a stale one', () => {
    const s = setup();
    create(s, { width: 5, height: 4 });
    submit(s, run('edit', { width: null }, ID));
    expect(value(s, ID, 'area') ?? null).toBeNull();
  });

  it('a feature whose type has no computed property is untouched', () => {
    const s = setup();
    s.w.add(fid(9), 'owner', { width: 1 });
    expect(
      planApi.planFor([run('create', { width: 1 }, fid(2))], oneVersion(s.config, s.perms), s.p).ok,
    ).toBe(true);
  });

  it('property: after any sequence of edits the computed values equal the expressions on the folded state', () => {
    const edit = fc.record(
      { width: fc.integer({ min: 0, max: 40 }), height: fc.integer({ min: 0, max: 40 }), label: fc.string() },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(edit, fc.array(edit, { maxLength: 6 }), (first, rest) => {
        const s = setup();
        const r = create(s, first);
        expect(r.ok).toBe(true);
        for (const input of rest) expect(submit(s, run('edit', input, ID)).ok).toBe(true);
        const w = value(s, ID, 'width');
        const h = value(s, ID, 'height');
        const both = typeof w === 'number' && typeof h === 'number';
        expect(value(s, ID, 'area') ?? null).toBe(both ? w * h : null);
        const area = value(s, ID, 'area');
        expect(value(s, ID, 'size_class') ?? null).toBe(
          typeof area === 'number' ? (area > 100 ? 'large' : 'small') : null,
        );
      }),
      { numRuns: 60 },
    );
  });
});

describe('plan: device prediction and server plan agree', () => {
  it('planning a create and an edit in one batch equals planning them one after the other', () => {
    const a = setup();
    const b = setup();
    const c = run('create', { width: 3, height: 7, label: 'x' }, ID);
    const e = run('edit', { width: 20 }, ID);
    const batch = planApi.planFor([c, e], oneVersion(a.config, a.perms), a.p);
    const first = submit(b, c);
    const second = submit(b, e);
    expect(batch.ok && first.ok && second.ok).toBe(true);
    const flat = (r: PlanResult): unknown[] => observed(r).map((o) => [o.property, o.result]);
    expect(flat(batch)).toEqual([...flat(first), ...flat(second)]);
  });
});

describe('plan: $recompute', () => {
  it('only the system may start it', () => {
    const s = setup();
    create(s, { width: 2, height: 2 });
    const r = planApi.planFor([run('$recompute', {}, ID, maker)], oneVersion(s.config, s.perms), s.p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('not_permitted');
  });

  it('writes every computed value that is missing or stale, and nothing the second time', () => {
    const s = setup();
    s.w.add(ID, 'parcel', { width: 6, height: 7 });
    const first = submit(s, run('$recompute', {}, ID, system));
    expect(written(first)).toEqual(['area', 'size_class']);
    expect(value(s, ID, 'area')).toBe(42);
    expect(written(submit(s, run('$recompute', {}, ID, system)))).toEqual([]);
  });

  it('refuses a feature that does not exist', () => {
    const s = setup();
    const r = planApi.planFor([run('$recompute', {}, fid(77), system)], oneVersion(s.config, s.perms), s.p);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('unknown_feature');
  });
});
