// WP-787: a false `when` that failed only on terms reading `actor.roles` is refused `not_permitted`; any other cause
// (or a mix) stays `not_available`. Both are refused at path `when`.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Key, Run } from '../model';
import { compilePerms } from '../perms';
import { createPlan, oneVersion } from './index';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const api = createPlan(formApi);
const ROLE = "'kontrolle' in actor.roles";
const OPEN = "self.stage != 'erledigt'";

const file = (whens: Record<string, string>) => ({
  schema: 'ueberblick/1',
  template: { key: 'rg', version: '1.0.0' },
  roles: { kontrolle: { label: 'Kontrolle' }, anderes: { label: 'Anderes' }, any: { label: 'Any' } },
  types: {
    baum: {
      label: 'Baum',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: { stage: { type: 'text' } },
    },
  },
  tasks: Object.fromEntries(
    Object.entries(whens).map(([k, when]) => [
      k,
      { label: k, on: 'baum', who: ['any'], when, then: [{ set: { stage: "'x'" } }] },
    ]),
  ),
});

/** Plans the task `t` on a tree with the given stage as a participant with the given roles; returns the refusal. */
function refusal(
  when: string,
  roles: readonly string[],
  stage: string,
): { code: string; path?: string } | undefined {
  const config = build(file({ t: when }));
  const world = new World(config);
  world.add(fid(1), 'baum', { stage });
  const run = {
    id: rid(1),
    task: 't' as Key,
    // everyone has the role `any` that `who` admits, so only the `when` decides here
    actor: actor('participant', 'anna', [...roles, 'any']),
    configVersion: 1,
    input: {},
    featureId: fid(1),
  } as Run;
  const res = api.planFor([run], oneVersion(config, compilePerms(config)), ports(world));
  if (res.ok) return undefined;
  return res.refusal;
}

describe('role-gated when: not_permitted only when the roles alone failed it', () => {
  const rows: [string, string, readonly string[], string, string | undefined][] = [
    [`${ROLE} && ${OPEN}`, 'role missing, state fine', [], 'offen', 'not_permitted'],
    [`${ROLE} && ${OPEN}`, 'role present, state wrong', ['kontrolle'], 'erledigt', 'not_available'],
    [`${ROLE} && ${OPEN}`, 'both false', [], 'erledigt', 'not_available'],
    [`${ROLE} && ${OPEN}`, 'both true', ['kontrolle'], 'offen', undefined],
    [`${ROLE} || self.stage == 'offen'`, 'or: role missing, state false', [], 'x', 'not_available'],
    [`${ROLE} || 'anderes' in actor.roles`, 'or: both role terms false', [], 'offen', 'not_permitted'],
    [`!(${ROLE})`, 'negated role term, role present', ['kontrolle'], 'offen', 'not_permitted'],
    [`!(${ROLE}) && ${OPEN}`, 'negated role, state wrong', ['kontrolle'], 'erledigt', 'not_available'],
    [ROLE, 'role term alone', [], 'offen', 'not_permitted'],
    [
      `${ROLE} && self.stage == 'offen' && 'anderes' in actor.roles`,
      'two role terms false, state true',
      [],
      'offen',
      'not_permitted',
    ],
    [`actor.roles.exists(r, r == 'kontrolle') && ${OPEN}`, 'exists over roles', [], 'offen', 'not_permitted'],
    [
      `actor.roles.exists(r, r == self.stage)`,
      'mixed leaf reads roles and state',
      [],
      'offen',
      'not_available',
    ],
    ["actor.kind == 'admin'", 'actor.kind only', [], 'offen', 'not_permitted'],
    ["actor.id == 'p-x'", 'actor.id only', [], 'offen', 'not_permitted'],
    ['self.stage == actor.id', 'state against actor.id', [], 'offen', 'not_available'],
    [
      "[1].exists(self, self == 1) && actor.id == 'p-x'",
      'a variable named like a state name is bound',
      [],
      'offen',
      'not_permitted',
    ],
    [
      "actor.roles.exists(r, r == 'a') && [1].exists(x, self.stage == 'y')",
      'self free outside the variable',
      ['a'],
      'offen',
      'not_available',
    ],
  ];
  it.each(rows)('%s (%s)', (when, _name, roles, stage, code) => {
    const r = refusal(when, roles, stage);
    expect(r?.code).toBe(code);
    if (r !== undefined) expect(r.path).toBe('when');
  });

  it('property: `role && state` is not_permitted exactly when the role is missing and the state is fine', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (hasRole, fine) => {
        const r = refusal(`${ROLE} && ${OPEN}`, hasRole ? ['kontrolle'] : [], fine ? 'offen' : 'erledigt');
        const expected = hasRole && fine ? undefined : !hasRole && fine ? 'not_permitted' : 'not_available';
        expect(r?.code).toBe(expected);
      }),
      { numRuns: 20 },
    );
  });
});
