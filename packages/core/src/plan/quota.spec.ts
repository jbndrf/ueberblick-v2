// WP-639: the creation quota of a role is a planner refusal, so the device and the server agree (R1).
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import type { PlanResult } from './contract';
import { actor, anna, build, golden, ports, rid, vera, World } from './__fixtures__/world';

const planApi = createPlan(formApi);
const input = { geometrie: { type: 'Point', coordinates: [7.1015, 50.7315] }, vitalitaet: 'v1' };

/** musterstadt with `quota` on the kontrolle role (and optionally on a second role). */
function world(quotas: Readonly<Record<string, number>>) {
  const file = structuredClone(golden('musterstadt-plain').file) as unknown as {
    roles: Record<string, { quota?: number }>;
    types: { baum: { permissions: { write: Record<string, string[]> } } };
  };
  file.types.baum.permissions.write['hoehe_m'] = ['kontrolle'];
  file.types.baum.permissions.write['hoehe_klasse'] = ['kontrolle'];
  for (const [role, q] of Object.entries(quotas)) file.roles[role] = { ...file.roles[role], quota: q };
  const config = build(file);
  const w = new World(config);
  return { config, w, perms: compilePerms(config), p: ports(w) };
}

let n = 5000;
const create = (who = anna): Run =>
  ({
    id: rid(++n),
    task: 'erfassen' as Key,
    actor: who,
    configVersion: 1,
    input: input as Record<string, Json>,
  }) as Run;

type Ctx = ReturnType<typeof world>;
/** Plans one create and, when accepted, records it on the store the way an accepted run is. */
function attempt(c: Ctx, who = anna): PlanResult {
  const r = planApi.planFor([create(who)], oneVersion(c.config, c.perms), c.p);
  if (r.ok) for (const pr of r.runs) c.w.append(pr.run.id, pr.observations, who.id);
  return r;
}
const code = (r: PlanResult): string | undefined => (r.ok ? undefined : r.refusal.code);

describe('creation quota', () => {
  it('refuses the create that would pass the quota, with quota_exceeded', () => {
    const c = world({ kontrolle: 2 });
    expect(attempt(c).ok).toBe(true);
    expect(attempt(c).ok).toBe(true);
    expect(code(attempt(c))).toBe('quota_exceeded');
  });

  it('counts per participant, not per role', () => {
    const c = world({ kontrolle: 1 });
    const other = actor('participant', 'dora', ['kontrolle']);
    expect(attempt(c).ok).toBe(true);
    expect(code(attempt(c))).toBe('quota_exceeded');
    expect(attempt(c, other).ok).toBe(true);
  });

  it('counts the creates of one batch (the facts do not hold them yet)', () => {
    const c = world({ kontrolle: 2 });
    const r = planApi.planFor([create(), create(), create()], oneVersion(c.config, c.perms), c.p);
    expect(code(r)).toBe('quota_exceeded');
    expect(planApi.planFor([create(), create()], oneVersion(c.config, c.perms), c.p).ok).toBe(true);
  });

  it('a deleted feature frees its place (v3)', () => {
    const c = world({ kontrolle: 1 });
    const first = attempt(c);
    if (!first.ok) throw new Error('first create refused');
    expect(code(attempt(c))).toBe('quota_exceeded');
    const created = first.runs[0]?.created[0];
    if (created === undefined) throw new Error('nothing created');
    c.w.append(rid(1), [{ featureId: created, property: '$lifecycle', result: 'deleted' }]);
    expect(attempt(c).ok).toBe(true);
  });

  it('no quota on any role means no limit; a role without quota does not lift nothing', () => {
    const c = world({});
    for (let i = 0; i < 6; i++) expect(attempt(c).ok).toBe(true);
  });

  it("the highest quota among a participant's roles counts", () => {
    const c = world({ kontrolle: 1, verwaltung: 3 });
    const both = actor('participant', 'eva', ['kontrolle', 'verwaltung']);
    for (let i = 0; i < 3; i++) expect(attempt(c, both).ok).toBe(true);
    expect(code(attempt(c, both))).toBe('quota_exceeded');
  });

  it('does not bind an admin, a system actor or an import', () => {
    const c = world({ kontrolle: 1, verwaltung: 1 });
    for (const kind of ['admin', 'system', 'import'] as const) {
      const who = actor(kind, `${kind}-1`, ['kontrolle']);
      expect(code(attempt(c, who))).not.toBe('quota_exceeded');
    }
    expect(vera.roles).toContain('verwaltung');
  });

  it('property: n attempts under a quota q accept exactly min(n, q), and the rest are quota_exceeded', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 0, max: 9 }), (q, tries) => {
        const c = world({ kontrolle: q });
        const results = Array.from({ length: tries }, () => attempt(c));
        expect(results.filter((r) => r.ok)).toHaveLength(Math.min(tries, q));
        for (const r of results.filter((x) => !x.ok)) expect(code(r)).toBe('quota_exceeded');
      }),
      { numRuns: 40 },
    );
  });

  it('the check asks the facts for at most the quota (bounded cost)', () => {
    const c = world({ kontrolle: 3 });
    const limits: number[] = [];
    const inner = c.w.createdBy;
    c.w.createdBy = (id, limit) => (limits.push(limit), inner(id, limit));
    planApi.planFor([create()], oneVersion(c.config, c.perms), c.p);
    expect(limits).toEqual([3]);
  });
});
