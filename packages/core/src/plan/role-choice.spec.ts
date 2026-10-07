// WP-455 (A-051): a `role` property holds role keys of the project; plan refuses a key the file does not declare.
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import { typeFits } from '../form/type';
import type { FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { allowedRoles } from '../registry/participant-select';
import { PropertySchema } from '../schema/property';
import type { PlanResult } from './contract';
import { createPlan, oneVersion } from './index';
import { World, actor, build, fid, ports, rid } from './__fixtures__/world';

const planApi = createPlan(formApi);
const POINT = { type: 'Point', coordinates: [1, 1] };
const file = {
  schema: 'ueberblick/1',
  template: { key: 'roles', version: '1.0.0' },
  roles: { worker: { label: 'W' }, lead: { label: 'L' }, guest: { label: 'O' } },
  types: {
    job: {
      label: 'Job',
      geometry: 'geom',
      permissions: { see: '$all', create: '$all', write: '$all' },
      properties: {
        geom: { type: 'geometry', geometry_type: 'point' },
        owner: { type: 'role' },
        owners: { type: 'role', cardinality: 'many' },
        picked: { type: 'role', select: { all: ['lead'], self: ['worker'] } },
      },
    },
  },
  tasks: { assign: { label: 'Assign', on: 'job', form: { owner: {}, owners: {}, picked: {} } } },
};
const config = build(file);
let n = 0;
function plan(who: string, input: Record<string, Json>, roles: string[] = ['worker']): PlanResult {
  const w = new World(config);
  const id: FeatureId = fid(1);
  w.add(id, 'job', { geom: POINT });
  const run: Run = {
    id: rid(++n),
    task: 'assign' as Key,
    actor: actor('participant', who, roles),
    configVersion: 1,
    input,
    featureId: id,
  };
  return planApi.planFor([run], oneVersion(config, compilePerms(config)), ports(w));
}
const code = (r: PlanResult): string => (r.ok ? 'ok' : r.refusal.code);

describe('role property in plan', () => {
  it('takes a declared role key, one or many', () => {
    expect(code(plan('bernd', { owner: 'lead' }))).toBe('ok');
    expect(code(plan('bernd', { owners: ['lead', 'worker'] }))).toBe('ok');
  });
  it('refuses a key the file does not declare', () => {
    expect(code(plan('bernd', { owner: 'ghost' }))).toBe('invalid_input');
    expect(code(plan('bernd', { owners: ['lead', 'ghost'] }))).toBe('invalid_input');
  });
  it('an empty value passes', () => {
    expect(code(plan('bernd', { owner: '' }))).toBe('ok');
  });
});

describe('role property select (WP-481, A-055)', () => {
  it('a role in select.all may pick any role', () => {
    expect(code(plan('vera', { picked: 'worker' }, ['lead']))).toBe('ok');
    expect(code(plan('vera', { picked: 'lead' }, ['lead']))).toBe('ok');
  });
  it('a role in select.self may pick only a role it holds', () => {
    expect(code(plan('bernd', { picked: 'worker' }))).toBe('ok');
    expect(code(plan('bernd', { picked: 'lead' }))).toBe('not_permitted');
  });
  it('a role in neither list may pick none; clearing passes', () => {
    expect(code(plan('x', { picked: 'worker' }, ['guest']))).toBe('not_permitted');
    expect(code(plan('x', { picked: '' }, ['guest']))).toBe('ok');
  });
  it('without select every role is offered', () => {
    expect(code(plan('x', { owner: 'lead' }, ['guest']))).toBe('ok');
  });
  it('allowedRoles is the one function (R1)', () => {
    const decl = ['worker', 'lead'];
    expect(allowedRoles({}, ['x'], decl)).toEqual(decl);
    expect(allowedRoles({ select: { self: ['worker'] } }, ['worker'], decl)).toEqual(['worker']);
    expect(allowedRoles({ select: { all: ['lead'] } }, ['worker'], decl)).toEqual([]);
  });
  it('the schema takes select on a role', () => {
    expect(PropertySchema.safeParse({ type: 'role', label: 'R', select: { all: ['lead'] } }).success).toBe(
      true,
    );
  });
});

describe('role property type', () => {
  it('value check follows cardinality', () => {
    expect(typeFits({ type: 'role' } as never, 'lead')).toBe(true);
    expect(typeFits({ type: 'role' } as never, ['lead'])).toBe(false);
    expect(typeFits({ type: 'role', cardinality: 'many' } as never, ['lead'])).toBe(true);
    expect(typeFits({ type: 'role', cardinality: 'many' } as never, 'lead')).toBe(false);
  });
  it('the schema takes cardinality and refuses reference options', () => {
    expect(PropertySchema.safeParse({ type: 'role', label: 'R', cardinality: 'many' }).success).toBe(true);
    expect(PropertySchema.safeParse({ type: 'role', label: 'R', to: 'x' }).success).toBe(false);
  });
});
