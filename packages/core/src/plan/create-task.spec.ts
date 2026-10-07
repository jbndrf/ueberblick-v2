// WP-382: the built-in `$create` task: an admin adds one Objekt (a row of a Tabelle) with values; `$lifecycle` lets the admin delete it.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formApi } from '../form';
import type { Actor, FeatureId, Json, Key, Run } from '../model';
import { compilePerms } from '../perms';
import { CREATE_TASK, LIFECYCLE_TASK } from '../registry';
import { SYSTEM_TASKS } from '../registry/admin';
import type { PlanResult } from './contract';
import { createPlan, oneVersion } from './index';
import { IDS, actor, anna, fid, musterstadt, ports, rid } from './__fixtures__/world';

const ADMIN: Actor = actor('admin', 'root');
const planApi = createPlan(formApi);
const NEW = fid(777);

const create = (
  values: Json,
  who: Actor = ADMIN,
  type: Json = 'baumart',
  id: FeatureId | undefined = NEW,
): Run => ({
  id: rid(60),
  task: CREATE_TASK as Key,
  actor: who,
  configVersion: 1,
  ...(id === undefined ? {} : { featureId: id }),
  input: { type, values },
});
function plan(run: Run): PlanResult {
  const { config, world } = musterstadt();
  return planApi.planFor([run], oneVersion(config, compilePerms(config)), ports(world));
}
const refusalOf = (r: PlanResult) => {
  if (r.ok) throw new Error('planned');
  return r.refusal;
};
const written = (r: PlanResult) => {
  if (!r.ok) throw new Error(r.refusal.message);
  return Object.fromEntries((r.runs[0]?.observations ?? []).map((o) => [o.property, o.result]));
};

describe('$create', () => {
  it('is in the registry with both labels', () => {
    const e = SYSTEM_TASKS.get(CREATE_TASK);
    expect(e.description).toContain('Admin');
    expect(e.description_de).toContain('Admin');
  });

  it('creates one Objekt with the given values, its type and its creator, as one run', () => {
    const r = plan(create({ name_de: 'Eiche', name_lat: 'Quercus' }));
    expect(written(r)).toEqual({
      $type: 'baumart',
      $created_by: 'root',
      name_de: 'Eiche',
      name_lat: 'Quercus',
    });
    if (r.ok) {
      expect(r.runs).toHaveLength(1);
      expect(r.runs[0]?.run.task).toBe(CREATE_TASK);
      expect(r.runs[0]?.created).toEqual([NEW]);
    }
  });

  it('leaves an empty value out and takes a fresh id when the run names none', () => {
    const r = plan(create({ name_de: 'Buche', name_lat: '' }, ADMIN, 'baumart', undefined));
    expect(written(r)).not.toHaveProperty('name_lat');
    if (r.ok) expect(r.runs[0]?.created).toHaveLength(1);
  });

  it.each([
    ['a missing required value', { name_lat: 'x' }, 'required_missing', 'properties.name_de'],
    ['an unknown property', { name_de: 'x', gibtsnicht: 1 }, 'invalid_input', 'input.values.gibtsnicht'],
    ['a system key', { name_de: 'x', $lifecycle: 'deleted' }, 'invalid_input', 'input.values.$lifecycle'],
    ['a type mismatch', { name_de: 5 }, 'invalid_input', 'input.values.name_de'],
  ])('refuses %s', (_n, values, code, path) => {
    const r = refusalOf(plan(create(values)));
    expect(r.code).toBe(code);
    expect(r.path).toBe(path);
  });

  it('refuses a participant, the system, an unknown type and a missing values object', () => {
    expect(refusalOf(plan(create({ name_de: 'x' }, anna))).code).toBe('not_permitted');
    expect(refusalOf(plan(create({ name_de: 'x' }, actor('system', 'system')))).code).toBe('not_permitted');
    expect(refusalOf(plan(create({ name_de: 'x' }, ADMIN, 'gibtsnicht'))).code).toBe('invalid_input');
    expect(refusalOf(plan(create('nope'))).code).toBe('invalid_input');
  });

  it('property: every valid name is written verbatim and the run creates exactly one Objekt', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim() !== ''),
        (name) => {
          const r = plan(create({ name_de: name }));
          expect(written(r)['name_de']).toBe(name);
          if (r.ok) expect(r.runs.flatMap((x) => x.created)).toEqual([NEW]);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('$lifecycle by an admin', () => {
  const life = (state: Json, who: Actor): Run => ({
    id: rid(61),
    task: LIFECYCLE_TASK as Key,
    actor: who,
    configVersion: 1,
    featureId: IDS.linde,
    input: { state },
  });
  it('lets the admin delete an Objekt', () => {
    const r = plan(life('deleted', ADMIN));
    expect(written(r)).toEqual({ $lifecycle: 'deleted' });
  });
  it('still refuses a participant', () => {
    expect(refusalOf(plan(life('deleted', anna))).code).toBe('not_permitted');
  });
});
