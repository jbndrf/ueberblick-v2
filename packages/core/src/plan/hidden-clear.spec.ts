// WP-760 (owner Q5): a stored field that the changed values hide is cleared when the run carries an explicit null.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Json, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { IDS, World, actor, anna, build, fid, musterstadt, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
let n = 100;
const setup = (stored: Record<string, Json>) => {
  const { config, world } = musterstadt();
  world.add(fid(60), 'baum', {
    geometrie: { type: 'Point', coordinates: [7.102, 50.732] },
    stage: 'erfasst',
    vitalitaet: 'v2',
    befund: 'alt',
    ...stored,
  });
  return { config, perms: compilePerms(config), p: ports(world) };
};
const plan = (s: ReturnType<typeof setup>, input: Record<string, Json>) => {
  const run = {
    id: rid(++n),
    task: 'kontrolle',
    actor: anna,
    configVersion: 1,
    input,
    featureId: fid(60),
  } as Run;
  const r = planApi.planFor([run], oneVersion(s.config, s.perms), s.p);
  if (!r.ok) throw new Error(`${r.refusal.code}: ${r.refusal.message}`);
  return r.runs[0]?.observations ?? [];
};
// vitalitaet v1 hides foto (relevant only from v3).
const hiding = { vitalitaet: 'v1', befund: 'gesund' };

describe('WP-760: cleared hidden fields', () => {
  it('a stored hidden field with an explicit null yields a cleared observation', () => {
    const obs = plan(setup({ foto: { sha256: 'aa11' } }), { ...hiding, foto: null });
    expect(obs).toContainEqual(
      expect.objectContaining({ featureId: fid(60), property: 'foto', result: null }),
    );
  });
  it('without a stored value nothing is written for the hidden field', () => {
    const obs = plan(setup({}), { ...hiding, foto: null });
    expect(obs.map((o) => o.property)).not.toContain('foto');
  });
  it('a stored hidden field without an explicit null is left alone', () => {
    const obs = plan(setup({ foto: { sha256: 'aa11' } }), hiding);
    expect(obs.map((o) => o.property)).not.toContain('foto');
  });
  it('a non-null value for a hidden field is never written', () => {
    const obs = plan(setup({ foto: { sha256: 'aa11' } }), { ...hiding, foto: { sha256: 'bb22' } });
    expect(obs.map((o) => o.property)).not.toContain('foto');
  });
  it('property: a null never clears a field that stays relevant (it is the ordinary empty path)', () => {
    fc.assert(
      fc.property(fc.constantFrom('v3', 'v4'), (v) => {
        // foto is relevant from v3: the null on it is not a hidden-clear, and `befund` is untouched.
        const obs = plan(setup({ foto: { sha256: 'aa11' } }), {
          vitalitaet: v,
          befund: 'gesund',
          foto: null,
        });
        expect(obs.filter((o) => o.property === 'befund')).toHaveLength(1);
        expect(obs.find((o) => o.property === 'befund')?.result).toBe('gesund');
      }),
    );
  });
  it('property: only keys the run sends as null are cleared', () => {
    fc.assert(
      fc.property(fc.boolean(), (send) => {
        const obs = plan(setup({ foto: { sha256: 'aa11' }, hoehe_m: 5 }), {
          ...hiding,
          ...(send ? { foto: null } : {}),
        });
        const props = obs.map((o) => o.property);
        expect(props.includes('foto')).toBe(send);
        expect(props).not.toContain('hoehe_m');
      }),
    );
  });
  void IDS;
});

// WP-765: guard cases for the hidden-clear path: write permission and a relevance flip within the run.
const file = {
  schema: 'ueberblick/1',
  template: { key: 'hc', version: '1.0.0' },
  roles: { staff: { label: 'Staff' }, chef: { label: 'Chef' } },
  types: {
    akte: {
      label: 'Akte',
      permissions: { see: '$all', create: '$all', write: { a: '$all', b: '$all', c: ['chef'] } },
      properties: { a: { type: 'text' }, b: { type: 'text' }, c: { type: 'text' } },
    },
  },
  tasks: {
    bearbeiten: {
      label: 'Bearbeiten',
      on: 'akte',
      form: {
        a: {},
        b: { relevant: "form.a == 'x'" },
        c: { relevant: "form.a == 'x'" },
      },
    },
  },
};
const staff = actor('participant', 'sam', ['staff']);
const run2 = (stored: Record<string, Json>, input: Record<string, Json>): PlanResult => {
  const config = build(file);
  const world = new World(config);
  world.add(fid(70), 'akte', stored);
  const r = {
    id: rid(++n),
    task: 'bearbeiten',
    actor: staff,
    configVersion: 1,
    input,
    featureId: fid(70),
  } as Run;
  return planApi.planFor([r], oneVersion(config, compilePerms(config)), ports(world));
};
const written = (r: PlanResult) =>
  r.ok ? r.runs.flatMap((x) => x.observations).map((o) => [o.property, o.result]) : [];

describe('WP-765: the hidden-clear path keeps its guards', () => {
  it('a clear of a key the actor may not write is refused with not_permitted', () => {
    const r = run2({ a: 'x', c: 'alt' }, { a: 'y', c: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('not_permitted');
  });
  it('a clear of a writable key in the same situation is accepted', () => {
    const r = run2({ a: 'x', b: 'alt' }, { a: 'y', b: null });
    expect(written(r)).toContainEqual(['b', null]);
  });
  it('relevant -> hidden in the same run: the null clears, a value is not written', () => {
    expect(written(run2({ a: 'x', b: 'alt' }, { a: 'y', b: null }))).toContainEqual(['b', null]);
    expect(written(run2({ a: 'x', b: 'alt' }, { a: 'y', b: 'neu' })).map(([k]) => k)).not.toContain('b');
  });
  it('hidden -> relevant in the same run: the field is an ordinary one and takes its value', () => {
    expect(written(run2({ a: 'y', b: 'alt' }, { a: 'x', b: 'neu' }))).toContainEqual(['b', 'neu']);
  });
});
